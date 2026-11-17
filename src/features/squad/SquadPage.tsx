// P01 小队工作区：成员列表、资料完整度、添加/编辑/删除、邀请与导入回调。
import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Send, Download } from 'lucide-react';
import { Button, Dialog, Drawer, ErrorNotice, Status } from '../../components/ui';
import type { Id, WorkspaceProps } from '../../contracts/services';
import { getMemberProfileStatus, getMissingProfileFields } from '../../domain/planning';
import { formatMoney } from '../../domain/money';
import { MemberEditor, draftFromMember, validateDraft, draftToMemberInput, findBlockingExpenses, type MemberDraft } from './MemberEditor';
import styles from './squad.module.css';

interface EditorState {
  memberId: Id | null; // null = 新增
  draft: MemberDraft;
}

export function SquadPage({ trip, execute, saveStatus, openInvite, openImport }: WorkspaceProps) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removingId, setRemovingId] = useState<Id | null>(null);
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);

  const completeCount = useMemo(
    () => trip.members.filter((m) => getMemberProfileStatus(m) === 'complete').length,
    [trip.members],
  );

  const openAdd = () => {
    setErrors({}); setSubmitError('');
    setEditor({ memberId: null, draft: draftFromMember() });
  };
  const openEdit = (memberId: Id) => {
    const member = trip.members.find((m) => m.id === memberId);
    if (!member) return;
    setErrors({}); setSubmitError('');
    setEditor({ memberId, draft: draftFromMember(member) });
  };

  const save = async () => {
    if (!editor) return;
    const { errors: nextErrors, budgetCap } = validateDraft(editor.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || budgetCap === undefined) return;
    const input = draftToMemberInput(editor.draft, budgetCap);
    setBusy(true); setSubmitError('');
    const payload = editor.memberId === null
      ? { type: 'member.add' as const, member: { id: `m-${Date.now().toString(36)}`, ...input } }
      : { type: 'member.update' as const, memberId: editor.memberId, changes: input };
    const result = await execute(payload);
    setBusy(false);
    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }
    setEditor(null);
  };

  const remove = async () => {
    if (!removingId) return;
    setBusy(true); setSubmitError('');
    const result = await execute({ type: 'member.remove', memberId: removingId });
    setBusy(false);
    if (!result.ok) {
      setSubmitError(result.error.message);
      return;
    }
    setRemovingId(null);
  };

  const blocked = removingId ? findBlockingExpenses(trip, removingId) : [];
  const removingMember = trip.members.find((m) => m.id === removingId);

  return (
    <div className={styles.squadPage}>
      <div className="page-heading">
        <h1>小队 · {trip.members.length} 人</h1>
        <Button onClick={openAdd} disabled={trip.members.length >= 20} aria-label="添加成员">
          <Plus size={20} /> 添加成员
        </Button>
      </div>
      <div className={styles.summary}>
        <span>{completeCount} 人资料完整</span>
        <Status status={saveStatus} />
        <span className={styles.grow} />
        <Button variant="ghost" onClick={openImport}><Download size={16} /> 导入反馈</Button>
      </div>
      {submitError && !editor && !removingId ? <ErrorNotice>{submitError}</ErrorNotice> : null}
      {trip.members.length >= 20 ? <p className={styles.formHint}>已达每旅行 20 人上限，可继续编辑或导出。</p> : null}

      {trip.members.length === 0 ? (
        <div className="empty-state">
          <p>还没有成员。添加第一位成员后即可比较方案。</p>
          <Button onClick={openAdd}><Plus size={20} /> 添加成员</Button>
          <Button variant="secondary" onClick={openImport}>导入文件</Button>
        </div>
      ) : (
        <>
          <table className={styles.memberTable}>
            <thead><tr><th>成员</th><th>出发地</th><th>预算上限</th><th>可用日期</th><th>偏好</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {trip.members.map((member) => {
                const status = getMemberProfileStatus(member);
                const missing = getMissingProfileFields(member);
                return (
                  <tr key={member.id}>
                    <td><span className={styles.memberName}>{member.name}</span><br /><span className={styles.memberSub}>{member.id}</span></td>
                    <td>{member.originCity ?? <span className="muted">待补充</span>}</td>
                    <td>{member.budgetCap === null ? <span className="muted">待补充</span> : formatMoney(member.budgetCap)}</td>
                    <td>{member.availability.length > 0 ? `${member.availability[0].start} 起${member.availability.length > 1 ? ` · 另 ${member.availability.length - 1} 段` : ''}` : <span className="muted">待补充</span>}</td>
                    <td>{member.preferences.length ? member.preferences.join('、') : <span className="muted">无</span>}</td>
                    <td><span className={`${styles.badge} ${status === 'complete' ? styles.badgeComplete : styles.badgeIncomplete}`}>{status === 'complete' ? '资料完整' : `待补 ${missing.join('、')}`}</span></td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.linkButton} onClick={() => openEdit(member.id)}>编辑</button>
                        <button className={styles.linkButton} onClick={() => openInvite(member.id)} aria-label={`邀请 ${member.name} 填写`}><Send size={16} /> 邀请</button>
                        <button className={`${styles.linkButton} ${styles.danger}`} onClick={() => { setSubmitError(''); setRemovingId(member.id); }} aria-label={`删除 ${member.name}`}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.cardList}>
            {trip.members.map((member) => {
              const status = getMemberProfileStatus(member);
              return (
                <div className={styles.memberCard} key={member.id}>
                  <div className={styles.memberCardHead}>
                    <strong>{member.name}</strong>
                    <button className={styles.linkButton} onClick={() => openEdit(member.id)}><Pencil size={16} /> 编辑</button>
                  </div>
                  <div className={styles.memberCardFields}>
                    <span>出发地：{member.originCity ?? '待补充'}</span>
                    <span>预算：{member.budgetCap === null ? '待补充' : formatMoney(member.budgetCap)}</span>
                    <span>日期：{member.availability.length ? `${member.availability[0].start} 起` : '待补充'}</span>
                    <span>{status === 'complete' ? '资料完整' : '资料待补充'}</span>
                  </div>
                  <div className={styles.memberCardActions}>
                    <Button variant="secondary" onClick={() => openInvite(member.id)}><Send size={16} /> 邀请</Button>
                    <Button variant="ghost" onClick={() => { setSubmitError(''); setRemovingId(member.id); }}><Trash2 size={16} /> 删除</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <Drawer open={editor !== null} title={editor?.memberId ? '编辑成员' : '添加成员'} onClose={() => setEditor(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setEditor(null)}>取消</Button>
          <Button onClick={save} disabled={busy}>{busy ? '保存中…' : '保存成员'}</Button>
        </>}>
        {editor ? (
          <>
            {submitError ? <ErrorNotice>{submitError}</ErrorNotice> : null}
            {editor.memberId && <p className={styles.formHint}>修改后可能需要重新确认方案。</p>}
            <MemberEditor draft={editor.draft} errors={errors}
              onChange={(draft) => { setEditor({ ...editor, draft }); setErrors({}); }} />
          </>
        ) : null}
      </Drawer>

      <Dialog open={removingId !== null} title="删除成员" onClose={() => setRemovingId(null)}
        footer={<>
          <Button variant="secondary" onClick={() => setRemovingId(null)}>取消</Button>
          <Button variant="danger" onClick={remove} disabled={busy || blocked.length > 0}>{busy ? '删除中…' : '确认删除'}</Button>
        </>}>
        {blocked.length > 0 ? (
          <div className={styles.blockedList}>
            <p>{removingMember?.name} 已被以下费用记录引用，不能删除：</p>
            <ul>{blocked.map((item) => <li key={item.id}>{item.title}</li>)}</ul>
            <p>请先到账本处理相关费用。</p>
          </div>
        ) : (
          <p>确认删除「{removingMember?.name}」？此操作会使现有方案的确认与意向失效。</p>
        )}
      </Dialog>
    </div>
  );
}

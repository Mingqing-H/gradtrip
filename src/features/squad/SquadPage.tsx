// P01 小队工作区：成员列表、资料完整度、添加/编辑/删除、邀请与导入回调。
import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Send, Download, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Dialog, Drawer, ErrorNotice, PageHeader, StatStrip, Stat, Avatar, StatusChip, TagChip, Notice } from '../../components/ui';
import type { Id, WorkspaceProps } from '../../contracts/services';
import { getMemberProfileStatus, getMissingProfileFields } from '../../domain/planning';
import { formatMoney } from '../../domain/money';
import { MemberEditor, draftFromMember, validateDraft, draftToMemberInput, findBlockingExpenses, type MemberDraft } from './MemberEditor';
import styles from './squad.module.css';
// Inline the URL in this route chunk so the first-screen image does not wait for a shared URL-only JS chunk.
const squadLandscape = new URL('../../assets/destinations/suzhou-480.webp', import.meta.url).href;
const squadLandscapeMobile = new URL('../../assets/destinations/suzhou-240.webp', import.meta.url).href;

interface EditorState {
  memberId: Id | null; // null = 新增
  draft: MemberDraft;
  initialFocusSelector?: string;
}

export function SquadPage({ trip, execute, openInvite, openImport }: WorkspaceProps) {
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
  const openEdit = (memberId: Id, focusMissing = false) => {
    const member = trip.members.find((m) => m.id === memberId);
    if (!member) return;
    setErrors({}); setSubmitError('');
    const missing = !member.name ? 'name' : !member.originCity ? 'originCity' : member.budgetCap === null ? 'budgetCap' : 'availability';
    setEditor({ memberId, draft: draftFromMember(member), initialFocusSelector: focusMissing ? '[data-profile-field="' + missing + '"]' : undefined });
  };

  const save = async () => {
    if (!editor) return;
    const { errors: nextErrors, budgetCap } = validateDraft(editor.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || budgetCap === undefined) return;
    const input = draftToMemberInput(editor.draft, budgetCap);
    setBusy(true); setSubmitError('');
    const payload = editor.memberId === null
      ? { type: 'member.add' as const, member: { id: crypto.randomUUID(), ...input } }
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
      <PageHeader title="小队" subtitle={completeCount === trip.members.length && completeCount > 0 ? '资料已齐，可以去比较方案' : completeCount + ' 人资料完整，' + (trip.members.length - completeCount) + ' 人待补充'} actions={<>
        <Button variant="secondary" onClick={openImport}><Download size={20}/>导入反馈</Button>
        <Button className="mobile-primary" onClick={openAdd} disabled={trip.members.length >= 20} aria-label="添加成员"><Plus size={20}/>添加成员</Button>
      </>}/>
      <StatStrip>
        <Stat label="成员" value={<>{trip.members.length} <small>/ 20 人上限</small></>}/>
        <Stat label="资料完整" value={completeCount + '/' + trip.members.length} note={<progress className={styles.progress} value={completeCount} max={Math.max(1, trip.members.length)} aria-label="成员资料完整度"/>}/>
        <Stat label="预算已填" value={trip.members.filter(m => m.budgetCap !== null).length + '/' + trip.members.length}/>
        <Stat label="日期已填" value={trip.members.filter(m => m.availability.length > 0).length + '/' + trip.members.length}/>
      </StatStrip>
      <div className={styles.rosterLayout}>
      <section className={styles.roster}>
      <div className="sheet-head"><h2>成员名册</h2></div>
      {submitError && !editor && !removingId ? <ErrorNotice>{submitError}</ErrorNotice> : null}
      {trip.members.length >= 20 ? <p className={styles.formHint}>已达每旅行 20 人上限，可继续编辑或导出。</p> : null}

      {trip.members.length === 0 ? (
        <div className="empty-state">
          <p>还没有成员。添加第一位成员后即可比较方案。</p>

          <Button variant="secondary" onClick={openImport}>导入文件</Button>
        </div>
      ) : (
        <>
          <table className={styles.memberTable}>
            <thead><tr><th>成员</th><th>预算上限</th><th>可用日期</th><th>偏好</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {trip.members.map((member, index) => {
                const status = getMemberProfileStatus(member);
                const missing = getMissingProfileFields(member);
                return (
                  <tr key={member.id}>
                    <td><span className={styles.memberIdentity}><Avatar name={member.name} index={index}/><span><span className={styles.memberName}>{member.name}</span><span className={styles.memberSubRow}>{member.originCity ?? '待补充'}</span></span></span></td>
                    <td>{member.budgetCap === null ? <span className="muted">待补充</span> : formatMoney(member.budgetCap)}</td>
                    <td>{member.availability.length > 0 ? `${member.availability[0].start} 起${member.availability.length > 1 ? ` · 另 ${member.availability.length - 1} 段` : ''}` : <span className="muted">待补充</span>}</td>
                    <td><div className={styles.tags}>{member.preferences.slice(0, 2).map(tag => <TagChip key={tag}>{tag}</TagChip>)}{member.preferences.length > 2 && <span>+{member.preferences.length - 2}</span>}</div></td>
                    <td><StatusChip tone={status === 'complete' ? 'success' : 'warning'}>{status === 'complete' ? '资料完整' : '待补 ' + missing.join('、')}</StatusChip></td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.linkButton} onClick={() => openEdit(member.id)} aria-label={"编辑 " + member.name}>编辑</button>
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
            {trip.members.map((member, index) => {
              const status = getMemberProfileStatus(member);
              return (
                <div className={styles.memberCard} key={member.id}>
                  <div className={styles.memberCardHead}>
                    <span className={styles.memberIdentity}><Avatar name={member.name} index={index}/><strong>{member.name}</strong></span>
                    <StatusChip tone={status === 'complete' ? 'success' : 'warning'}>{status === 'complete' ? '资料完整' : '待补 ' + getMissingProfileFields(member).join('、')}</StatusChip>
                  </div>
                  <div className={styles.memberCardFields}>{member.originCity ?? '待补出发地'} · {member.budgetCap === null ? '待补预算' : formatMoney(member.budgetCap)} · {member.availability.length ? member.availability[0].start.slice(5) + ' 起' : '待补日期'}</div>
                  {member.preferences.length > 0 && <div className={styles.tags}>{member.preferences.slice(0, 2).map(tag => <TagChip key={tag}>{tag}</TagChip>)}</div>}
                  <div className={styles.memberCardActions}><Button variant="ghost" onClick={() => openEdit(member.id)} aria-label={"编辑 " + member.name}><Pencil size={16}/>编辑</Button>
                    <Button variant="ghost" onClick={() => openInvite(member.id)} aria-label={"邀请 " + member.name + " 填写"}><Send size={16} /> 邀请</Button>
                    <Button variant="ghost" aria-label={"删除 " + member.name} onClick={() => { setSubmitError(''); setRemovingId(member.id); }}><Trash2 size={16} /> 删除</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      </section>
      <aside className={styles.aside}>
        <figure className={styles.landscape} data-asset-id="asset-dest-suzhou"><picture><source media="(max-width: 767px)" srcSet={squadLandscapeMobile}/><img src={squadLandscape} width={480} height={270} alt="苏州园林示意插画" decoding="async" fetchPriority="high"/></picture><figcaption>示意图</figcaption></figure>
        {completeCount === trip.members.length && completeCount > 0 ? <div className={styles.pending}><Notice tone="success">成员资料已齐</Notice><Link className="next-step" to={'/trip/' + trip.id + '/plans'}>查看方案<ArrowRight size={20}/></Link></div> : <section className={styles.pending}><h2>待补充 <span className="muted">{trip.members.length - completeCount}</span></h2>{trip.members.filter(m => getMemberProfileStatus(m) !== 'complete').map(member => <div className={styles.pendingRow} key={member.id}><Avatar name={member.name} index={trip.members.indexOf(member)}/><div><strong>{member.name}</strong><span>{getMissingProfileFields(member).join('、')}</span></div><Button variant="ghost" onClick={() => openEdit(member.id, true)}>补充</Button></div>)}</section>}
      </aside>
      </div>
      <Drawer initialFocusSelector={editor?.initialFocusSelector} open={editor !== null} title={editor?.memberId ? '编辑成员' : '添加成员'} onClose={() => setEditor(null)}
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

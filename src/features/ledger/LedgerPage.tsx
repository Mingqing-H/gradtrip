/**
 * P04 账本页：账目 / 结算分段；记一笔（分配预览）、逐人余额、转账建议与更正。
 *
 * 页面只调用 execute 与领域查询，不自行实现分摊/余额/建议算法。
 */
import { useMemo, useState } from 'react';
import { ArrowRight, Plus, Receipt, RotateCcw, ShieldAlert } from 'lucide-react';
import { Button, Dialog, ErrorNotice, Input, Select, Status } from '../../components/ui';
import { formatMoney, parseMoney } from '../../domain/money';
import { getLedgerSummary } from '../../domain/ledger/balances';
import {
  buildSettlementSuggestions,
  validateSettlementRecording,
} from '../../domain/ledger/settlement';
import {
  splitEqualCents,
  summarizeCustomAllocations,
  type CustomAllocationDraft,
} from '../../domain/ledger/split';
import type { Expense, WorkspaceProps } from '../../contracts/services';
import styles from './LedgerPage.module.css';

type SplitMode = 'equal' | 'custom';

type ExpenseForm = {
  title: string;
  date: string;
  category: string;
  payerId: string;
  amountText: string;
  splitMode: SplitMode;
  participantIds: string[];
  custom: Record<string, string>;
};

const CATEGORIES = ['餐饮', '住宿', '交通', '活动', '其他'];

function emptyForm(trip: WorkspaceProps['trip']): ExpenseForm {
  return {
    title: '',
    date: trip.searchWindow.start,
    category: '餐饮',
    payerId: trip.members[0]?.id ?? '',
    amountText: '',
    splitMode: 'equal',
    participantIds: trip.members.map((member) => member.id),
    custom: {},
  };
}

export function LedgerPage({ trip, execute, saveStatus }: WorkspaceProps) {
  const [tab, setTab] = useState<'expenses' | 'settlement'>('expenses');
  const [form, setForm] = useState<ExpenseForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [transfer, setTransfer] = useState<{
    fromId: string;
    toId: string;
    amount: number;
    amountText: string;
  } | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);

  const memberIds = useMemo(() => trip.members.map((member) => member.id), [trip.members]);
  const nameOf = (id: string) => trip.members.find((member) => member.id === id)?.name ?? id;
  const summary = useMemo(
    () => getLedgerSummary(memberIds, trip.expenses, trip.settlements),
    [memberIds, trip.expenses, trip.settlements],
  );
  const suggestions = useMemo(
    () => buildSettlementSuggestions(summary.balances),
    [summary.balances],
  );
  const sortedExpenses = useMemo(
    () =>
      [...trip.expenses].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      ),
    [trip.expenses],
  );

  const amountCents = useMemo(() => {
    if (form === null) return null;
    try {
      return parseMoney(form.amountText);
    } catch {
      return Number.NaN;
    }
  }, [form]);

  const allocations = useMemo((): CustomAllocationDraft[] | null => {
    if (form === null) return null;
    if (form.splitMode === 'custom') {
      return form.participantIds.map((memberId) => {
        const text = form.custom[memberId] ?? '';
        let amount: number | null = null;
        if (text.trim() !== '') {
          try {
            const parsed = parseMoney(text);
            // 非法输入保留 NaN 供提交时提示，但不能进入求和导致 NaN 传播到 formatMoney。
            amount = Number.isSafeInteger(parsed) ? parsed : Number.NaN;
          } catch {
            amount = Number.NaN;
          }
        }
        return { memberId, amount };
      });
    }
    if (amountCents === null || !Number.isSafeInteger(amountCents) || amountCents <= 0) return [];
    return splitEqualCents(amountCents, form.participantIds).map((allocation) => ({
      memberId: allocation.memberId,
      amount: allocation.amount,
    }));
  }, [form, amountCents]);

  const allocationPreview = useMemo(() => {
    if (
      form === null ||
      amountCents === null ||
      !Number.isSafeInteger(amountCents) ||
      allocations === null
    ) {
      return null;
    }
    const summary = summarizeCustomAllocations(amountCents, allocations);
    // 自定义金额含非法输入（NaN）时不生成可渲染的预览，避免 NaN 进入金额格式化。
    if (!Number.isSafeInteger(summary.filledTotal) || !Number.isSafeInteger(summary.difference)) return null;
    return summary;
  }, [form, amountCents, allocations]);

  const openCreate = () => {
    if (summary.hasActiveSettlement) {
      setError('已有有效结算记录，费用已锁定。请到结算页撤销全部结算记录后再更正。');
      return;
    }
    setEditingId(null);
    setForm(emptyForm(trip));
    setError(null);
  };

  const openEdit = (expense: Expense) => {
    if (summary.hasActiveSettlement) {
      setError('已有有效结算记录，费用已锁定。请到结算页撤销全部结算记录后再更正。');
      return;
    }
    setEditingId(expense.id);
    setForm({
      title: expense.title,
      date: expense.date,
      category: expense.category,
      payerId: expense.payerId,
      amountText: (expense.amount / 100).toFixed(2),
      splitMode: expense.splitMode,
      participantIds: expense.allocations.map((allocation) => allocation.memberId),
      custom: Object.fromEntries(
        expense.allocations.map((allocation) => [allocation.memberId, (allocation.amount / 100).toFixed(2)]),
      ),
    });
    setError(null);
  };

  const submitExpense = async () => {
    if (form === null) return;
    setError(null);
    if (amountCents === null || Number.isNaN(amountCents) || amountCents <= 0) {
      setError('请输入大于 0 的金额，最多两位小数');
      return;
    }
    if (form.title.trim() === '') {
      setError('请填写项目名称');
      return;
    }
    if (form.participantIds.length === 0) {
      setError('至少选择一位参与成员');
      return;
    }
    if (allocations === null || allocationPreview === null) return;
    if (allocations.some((allocation) => allocation.amount === null || Number.isNaN(allocation.amount))) {
      setError('自定义分摊存在未填写或非法的金额');
      return;
    }
    const finalAllocations = allocations.map((allocation) => ({
      memberId: allocation.memberId,
      amount: allocation.amount as number,
    }));
    const expense: Expense = {
      id: editingId ?? 'pending',
      title: form.title.trim(),
      date: form.date,
      category: form.category,
      amount: amountCents,
      payerId: form.payerId,
      splitMode: form.splitMode,
      allocations: finalAllocations,
      createdAt: trip.createdAt,
    };
    setBusy(true);
    try {
      const result = editingId
        ? await execute({ type: 'ledger.updateExpense', expenseId: editingId, expense })
        : await execute({ type: 'ledger.addExpense', expense });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setForm(null);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async (payload: Parameters<typeof execute>[0]) => {
    setError(null);
    setBusy(true);
    try {
      const result = await execute(payload);
      if (!result.ok) setError(result.error.message);
    } finally {
      setBusy(false);
    }
  };

  const openTransfer = (suggestion: { fromId: string; toId: string; amount: number }) => {
    setTransfer({
      fromId: suggestion.fromId,
      toId: suggestion.toId,
      amount: suggestion.amount,
      amountText: (suggestion.amount / 100).toFixed(2),
    });
    setError(null);
  };

  const submitTransfer = async () => {
    if (transfer === null) return;
    setError(null);
    let amount: number;
    try {
      amount = parseMoney(transfer.amountText);
    } catch {
      setError('转账金额请输入最多两位小数的正数');
      return;
    }
    const validation = validateSettlementRecording(summary.balances, {
      fromId: transfer.fromId,
      toId: transfer.toId,
      amount,
    });
    if (validation !== null) {
      setError(validation.message);
      return;
    }
    const result = await execute({
      type: 'ledger.recordSettlement',
      settlementId: `settlement-${Date.now()}`,
      fromId: transfer.fromId,
      toId: transfer.toId,
      amount,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setTransfer(null);
  };

  const toggleRow = (id: string) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (trip.members.length === 0) {
    return (
      <section className={styles.page}>
        <h1>账本</h1>
        <div className="empty-state">
          <h2>还没有小队成员</h2>
          <p className="muted">请先在“小队”添加成员，再记录实际费用。</p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <h1>账本</h1>
        <Button onClick={openCreate} disabled={busy || summary.hasActiveSettlement}>
          <Plus size={20} /> 记一笔
        </Button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="账本视图">
        <button
          role="tab"
          aria-selected={tab === 'expenses'}
          className={tab === 'expenses' ? styles.activeTab : styles.tab}
          onClick={() => setTab('expenses')}
        >
          账目
        </button>
        <button
          role="tab"
          aria-selected={tab === 'settlement'}
          className={tab === 'settlement' ? styles.activeTab : styles.tab}
          onClick={() => setTab('settlement')}
        >
          结算
        </button>
      </div>

      <Status status={saveStatus} />
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      {tab === 'expenses' && (
        <>
          <p className="muted">实际支出 {formatMoney(summary.totalExpense)} · {summary.expenseCount} 笔</p>
          {summary.hasActiveSettlement && (
            <ErrorNotice>
              <ShieldAlert size={18} /> 已有有效结算记录，费用修改已锁定。请先到“结算”撤销全部结算记录再更正。
            </ErrorNotice>
          )}
          {sortedExpenses.length === 0 ? (
            <div className="empty-state">
              <h2>还没有费用</h2>
              <Button onClick={openCreate}>
                <Plus size={20} /> 记一笔
              </Button>
            </div>
          ) : (
            <ul className={styles.expenseList}>
              {sortedExpenses.map((expense) => (
                <li key={expense.id} className={styles.expenseRow}>
                  <button className={styles.expenseMain} onClick={() => toggleRow(expense.id)} aria-expanded={expandedRows.has(expense.id)}>
                    <span className={styles.expenseTitle}>
                      <Receipt size={18} /> {expense.title}
                    </span>
                    <span className={styles.expenseAmount}>{formatMoney(expense.amount)}</span>
                    <span className={styles.expenseMeta}>
                      {expense.date} · {expense.category} · {nameOf(expense.payerId)} 垫付
                    </span>
                  </button>
                  {expandedRows.has(expense.id) && (
                    <div className={styles.expenseDetail}>
                      <p className="muted">
                        {expense.splitMode === 'equal' ? '均摊' : '自定义'} · 共 {expense.allocations.length} 人参与
                      </p>
                      <ul>
                        {expense.allocations.map((allocation) => (
                          <li key={allocation.memberId}>
                            {nameOf(allocation.memberId)}：承担 {formatMoney(allocation.amount)}
                          </li>
                        ))}
                      </ul>
                      <Button variant="secondary" onClick={() => openEdit(expense)} disabled={summary.hasActiveSettlement}>
                        编辑
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => void run({ type: 'ledger.removeExpense', expenseId: expense.id })}
                        disabled={summary.hasActiveSettlement}
                      >
                        删除
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'settlement' && (
        <>
          <h2>成员余额</h2>
          {summary.balances.every((row) => row.balance === 0) && summary.expenseCount > 0 && (
            <p className={styles.settled}>当前已结清</p>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">成员</th>
                  <th scope="col">已付</th>
                  <th scope="col">应承担</th>
                  <th scope="col">已转出</th>
                  <th scope="col">已转入</th>
                  <th scope="col">当前余额</th>
                </tr>
              </thead>
              <tbody>
                {summary.balances.map((row) => (
                  <tr key={row.memberId}>
                    <th scope="row">{nameOf(row.memberId)}</th>
                    <td>{formatMoney(row.paid)}</td>
                    <td>{formatMoney(row.owed)}</td>
                    <td>{formatMoney(row.sent)}</td>
                    <td>{formatMoney(row.received)}</td>
                    <td className={styles.balance}>
                      {row.balance > 0
                        ? `应收 ${formatMoney(row.balance)}`
                        : row.balance < 0
                          ? `应付 ${formatMoney(-row.balance)}`
                          : '已结清'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>转账建议</h2>
          <p className="muted">仅为减少操作的建议，不承诺最少笔数。</p>
          {suggestions.length === 0 ? (
            <p className={styles.settled}>{summary.expenseCount === 0 ? '暂无费用，没有转账建议' : '当前没有待转账建议'}</p>
          ) : (
            <ul className={styles.suggestions}>
              {suggestions.map((suggestion) => (
                <li key={`${suggestion.fromId}-${suggestion.toId}`}>
                  <span>
                    {nameOf(suggestion.fromId)} <ArrowRight size={16} /> {nameOf(suggestion.toId)}
                  </span>
                  <strong>{formatMoney(suggestion.amount)}</strong>
                  <Button variant="secondary" onClick={() => openTransfer(suggestion)} disabled={busy}>
                    记录已转账
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <h2>结算记录</h2>
          {trip.settlements.length === 0 ? (
            <p className="muted">还没有结算记录。</p>
          ) : (
            <ul className={styles.settlements}>
              {trip.settlements.map((settlement) => (
                <li key={settlement.id}>
                  {nameOf(settlement.fromId)} → {nameOf(settlement.toId)} · {formatMoney(settlement.amount)} ·{' '}
                  {settlement.voidedAt === null ? '已记录' : '已撤销（不计入余额）'}
                </li>
              ))}
            </ul>
          )}
          {trip.settlements.some((settlement) => settlement.voidedAt === null) && (
            <Button variant="danger" onClick={() => setConfirmVoid(true)} disabled={busy}>
              <RotateCcw size={18} /> 撤销全部结算记录
            </Button>
          )}
          <p className="muted">撤销只移除本地记录效力，真实线下转账不会被撤回。撤销后可更正费用并按真实情况重新登记。</p>
        </>
      )}

      <Dialog
        open={form !== null}
        title={editingId === null ? '记一笔' : '编辑费用'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              取消
            </Button>
            <Button onClick={() => void submitExpense()} disabled={busy}>
              保存费用
            </Button>
          </>
        }
      >
        {form !== null && (
          <>
            {error !== null && <ErrorNotice>{error}</ErrorNotice>}
            <Input
              label="金额（元）"
              inputMode="decimal"
              value={form.amountText}
              onChange={(event) => setForm({ ...form, amountText: event.target.value })}
            />
            <Input
              label="项目名称"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <div className={styles.formRow}>
              <Input
                label="日期"
                type="date"
                value={form.date}
                onChange={(event) => setForm({ ...form, date: event.target.value })}
              />
              <Select
                label="类别"
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </div>
            <Select
              label="垫付人（可不参与消费）"
              value={form.payerId}
              onChange={(event) => setForm({ ...form, payerId: event.target.value })}
            >
              {trip.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
            <fieldset className={styles.participants}>
              <legend>参与成员（仅勾选者承担）</legend>
              {trip.members.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    checked={form.participantIds.includes(member.id)}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...form.participantIds, member.id]
                        : form.participantIds.filter((id) => id !== member.id);
                      setForm({ ...form, participantIds: next });
                    }}
                  />
                  {member.name}
                </label>
              ))}
              <div className={styles.participantActions}>
                <Button
                  variant="ghost"
                  onClick={() => setForm({ ...form, participantIds: memberIds })}
                >
                  全选
                </Button>
                <Button variant="ghost" onClick={() => setForm({ ...form, participantIds: [] })}>
                  清空
                </Button>
              </div>
            </fieldset>
            <div className={styles.splitTabs} role="tablist" aria-label="分摊方式">
              <button
                role="tab"
                aria-selected={form.splitMode === 'equal'}
                className={form.splitMode === 'equal' ? styles.activeSplit : styles.splitTab}
                onClick={() => setForm({ ...form, splitMode: 'equal' })}
              >
                均摊
              </button>
              <button
                role="tab"
                aria-selected={form.splitMode === 'custom'}
                className={form.splitMode === 'custom' ? styles.activeSplit : styles.splitTab}
                onClick={() => setForm({ ...form, splitMode: 'custom' })}
              >
                自定义
              </button>
            </div>
            <ul className={styles.allocationList}>
              {(allocations ?? []).map((allocation) => {
                const raw = allocation.amount;
                return (
                  <li key={allocation.memberId}>
                    <span>{nameOf(allocation.memberId)}</span>
                    {form.splitMode === 'custom' ? (
                      <Input
                        label={`${nameOf(allocation.memberId)} 分摊金额（元）`}
                        inputMode="decimal"
                        value={form.custom[allocation.memberId] ?? ''}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            custom: { ...form.custom, [allocation.memberId]: event.target.value },
                          })
                        }
                      />
                    ) : (
                      <strong>
                        {raw === null || Number.isNaN(raw) ? '待计算' : formatMoney(raw)}
                      </strong>
                    )}
                  </li>
                );
              })}
            </ul>
            {allocationPreview !== null && (
              <p className={allocationPreview.complete ? styles.allocated : styles.pending}>
                已分配 {formatMoney(allocationPreview.filledTotal)} / 总额{' '}
                {amountCents !== null && !Number.isNaN(amountCents) ? formatMoney(amountCents) : '—'}
                {allocationPreview.difference !== 0 && (
                  <> · {allocationPreview.difference > 0 ? '待分配' : '超出'} {formatMoney(Math.abs(allocationPreview.difference))}</>
                )}
              </p>
            )}
          </>
        )}
      </Dialog>

      <Dialog
        open={transfer !== null}
        title="记录已转账"
        onClose={() => setTransfer(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTransfer(null)}>
              取消
            </Button>
            <Button onClick={() => void submitTransfer()} disabled={busy}>
              记录此笔转账
            </Button>
          </>
        }
      >
        {transfer !== null && (
          <>
            {error !== null && <ErrorNotice>{error}</ErrorNotice>}
            <p>
              {nameOf(transfer.fromId)} <ArrowRight size={18} /> {nameOf(transfer.toId)}
            </p>
            <Input
              label="转账金额（元，可小于建议金额）"
              inputMode="decimal"
              value={transfer.amountText}
              onChange={(event) => setTransfer({ ...transfer, amountText: event.target.value })}
            />
            <p className="muted">仅记录已在线下完成的转账，不调用支付、不证明真实到账。</p>
          </>
        )}
      </Dialog>

      <Dialog
        open={confirmVoid}
        title="撤销全部结算记录"
        onClose={() => setConfirmVoid(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmVoid(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void run({ type: 'ledger.voidAllSettlements' });
                setConfirmVoid(false);
              }}
              disabled={busy}
            >
              确认撤销
            </Button>
          </>
        }
      >
        <p>将撤销全部有效结算记录，撤销后才可以修改费用。</p>
        <p className="muted">这只会改变本地账本，真实线下转账不会被撤回；撤销后请按真实情况重新登记转账。</p>
      </Dialog>
    </section>
  );
}

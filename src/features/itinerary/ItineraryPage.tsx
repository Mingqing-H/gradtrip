/**
 * P03 日程页：按天时间线 + 桌面右侧预算摘要、手机单列。
 *
 * 页面只调用 execute / services，不操作存储、不复制业务算法；
 * 所有余额/预算/排序/重叠均由领域选择器计算。
 */
import { useMemo, useState, useRef } from 'react';
import {
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock3,
  Bus, BedDouble, UtensilsCrossed, Camera, MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button, Dialog, Drawer, ErrorNotice, Input, ActionMenu, Select, PageHeader, StatusChip } from '../../components/ui';
import { formatMoney, parseMoney } from '../../domain/money';
import { addDays } from '../../domain/dates';
import {
  findOutOfRangeActivities,
  findTimeOverlaps,
  groupActivitiesByDate,
} from '../../domain/itinerary/activity';
import { getItineraryBudget } from '../../domain/itinerary/budget';
import type { Activity, WorkspaceProps } from '../../contracts/services';
import styles from './ItineraryPage.module.css';

type ActivityForm = {
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  category: string;
  budgetBucket: Activity['budgetBucket'];
  perPersonEstimate: string;
  note: string;
};

const categoryIcons: Record<string, typeof Bus> = { '交通': Bus, '住宿': BedDouble, '餐饮': UtensilsCrossed, '活动': Camera };
const CATEGORIES = ['交通', '住宿', '餐饮', '活动', '其他'];

function emptyForm(date: string, bucket: Activity['budgetBucket'] = 'activities'): ActivityForm {
  return {
    date,
    startTime: '',
    endTime: '',
    title: '',
    category: bucket === 'activities' ? '活动' : '交通',
    budgetBucket: bucket,
    perPersonEstimate: '',
    note: '',
  };
}

function formFromActivity(activity: Activity): ActivityForm {
  return {
    date: activity.date,
    startTime: activity.startTime ?? '',
    endTime: activity.endTime ?? '',
    title: activity.title,
    category: activity.category,
    budgetBucket: activity.budgetBucket,
    perPersonEstimate:
      activity.perPersonEstimate === null ? '' : (activity.perPersonEstimate / 100).toFixed(2),
    note: activity.note,
  };
}

function parseMoneyCents(text: string): number | null {
  if (text.trim() === '') return null;
  try { return parseMoney(text); } catch { return Number.NaN; }
}

export function ItineraryPage({ trip, execute, services }: WorkspaceProps) {
  const { activities, dateRange } = trip.itinerary;
  const dayRefs = useRef<Record<string, HTMLElement | null>>({});
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState<ActivityForm>(emptyForm(dateRange?.start ?? ''));
  const [draftRange, setDraftRange] = useState({ start: trip.searchWindow.start, end: addDays(trip.searchWindow.start, trip.duration - 1) });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const groups = useMemo(() => groupActivitiesByDate(activities), [activities]);
  const overlaps = useMemo(() => findTimeOverlaps(activities), [activities]);
  const outOfRange = useMemo(
    () => (dateRange === null ? [] : findOutOfRangeActivities(activities, dateRange)),
    [activities, dateRange],
  );
  const overlapIds = useMemo(
    () => new Set(overlaps.flatMap((overlap) => [overlap.firstId, overlap.secondId])),
    [overlaps],
  );

  // 个人基准估算 E_i 由 T02 规划服务注入；本页只展示可见差额，不重新估算。
  const plan = trip.plans.find(candidate => candidate.id === trip.confirmation?.planId)
    ?? trip.plans.find(candidate => candidate.id === trip.itinerary.sourcePlanId);
  const baseEstimates = useMemo(() => Object.fromEntries(trip.members.map(member => [
    member.id, plan ? services.planning.evaluatePersonalPlan({ member, plan }).total : null,
  ])), [trip.members, plan, services.planning]);
  const budget = useMemo(
    () =>
      getItineraryBudget({
        activities,
        planActivitiesEstimate: plan?.estimate.activities ?? 0,
        members: trip.members,
        baseEstimates,
      }),
    [activities, plan?.estimate.activities, trip.members, baseEstimates],
  );

  const budgetExpanded = budgetOpen;

  const openCreate = (date: string) => {
    setForm(emptyForm(date));
    setEditing({ id: null });
    setError(null);
  };
  const openEdit = (activity: Activity) => {
    setForm(formFromActivity(activity));
    setEditing({ id: activity.id });
    setError(null);
  };

  const submit = async () => {
    setError(null);
    const cents = form.budgetBucket === 'included' ? null : parseMoneyCents(form.perPersonEstimate);
    if (cents !== null && Number.isNaN(cents)) {
      setError('人均预计支出请输入最多两位小数的非负金额');
      return;
    }
    const startTime = form.startTime === '' ? null : form.startTime;
    const endTime = form.endTime === '' ? null : form.endTime;
    const activity: Activity = {
      id: editing?.id ?? 'pending',
      date: form.date,
      startTime,
      endTime,
      title: form.title,
      category: form.category,
      budgetBucket: form.budgetBucket,
      perPersonEstimate: cents,
      note: form.note,
      order: 0,
    };
    setBusy(true);
    try {
      const result = editing?.id
        ? await execute({
            type: 'itinerary.update',
            activityId: editing.id,
            changes: {
              date: activity.date,
              startTime: activity.startTime,
              endTime: activity.endTime,
              title: activity.title,
              category: activity.category,
              budgetBucket: activity.budgetBucket,
              perPersonEstimate: activity.perPersonEstimate,
              note: activity.note,
            },
          })
        : await execute({
            type: 'itinerary.add',
            activity,
            ...(dateRange === null
              ? { dateRange: draftRange }
              : {}),
          });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  const run = async (payload: Parameters<typeof execute>[0]) => {
    setError(null);
    const result = await execute(payload);
    if (!result.ok) setError(result.error.message);
  };

  return (
    <section className={styles.page}>
      <PageHeader title="日程" subtitle={dateRange ? dateRange.start + ' 至 ' + dateRange.end + ' · ' + groups.length + ' 天' : '尚未绑定日期范围'} actions={<Button className="mobile-primary" onClick={() => openCreate(dateRange?.start ?? trip.searchWindow.start)} disabled={busy}><CalendarPlus size={20}/>添加安排</Button>}/>
      {groups.length > 0 && <nav className={styles.dayNav} aria-label="日程日期">{groups.map((group, index) => <button key={group.date} onClick={() => dayRefs.current[group.date]?.scrollIntoView({ block: 'start' })}>第 {index + 1} 天 <span>{group.date.slice(5)}</span></button>)}</nav>}
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {outOfRange.length > 0 && (
        <ErrorNotice>
          有 {outOfRange.length} 项活动超出当前方案日期范围，需要调整日期后才能生成正式计划快照。
        </ErrorNotice>
      )}
      {overlaps.length > 0 && (
        <div className={styles.notice} role="status">
          有 {overlaps.length} 组活动时间重叠，可继续保存，建议调整。
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.timeline}>
          {groups.length === 0 && (
            <div className="empty-state">
              <h2>还没有日程安排</h2>
              <p className="muted">添加第一项安排；未确认方案也可以先建立草稿日程。</p>

            </div>
          )}
          {groups.map((group, dayIndex) => (
            <section key={group.date} ref={element => { dayRefs.current[group.date] = element; }} className={styles.day}>
              <header className={styles.dayHeading}>
                <h2><span>第 {dayIndex + 1} 天</span> {group.date}</h2>
                <Button variant="ghost" onClick={() => openCreate(group.date)}>
                  <Plus size={18} /> 添加
                </Button>
              </header>
              {group.activities.length === 0 && (
                <p className={`muted ${styles.emptyDay}`}>添加这天的安排</p>
              )}
              <ul className={styles.list}>
                {group.activities.map((activity) => { const CategoryIcon = categoryIcons[activity.category] ?? MapPin; return (
                  <li
                    key={activity.id}
                    className={`${styles.item} ${overlapIds.has(activity.id) ? styles.overlap : ''} ${
                      outOfRange.some((item) => item.id === activity.id) ? styles.outOfRange : ''
                    }`}
                  >
                    <div className={styles.time}>
                      {activity.startTime === null
                        ? '未定时间'
                        : `${activity.startTime}–${activity.endTime}`}
                    </div>
                    <div className={styles.itemBody}>
                      <span className={styles.categoryIcon} data-category={activity.category}><CategoryIcon size={18} aria-hidden="true"/></span><strong>{activity.title}</strong>
                      <span className={styles.meta}>
                        {activity.category} ·{' '}
                        {activity.budgetBucket === 'included'
                          ? '费用已含于方案'
                          : activity.perPersonEstimate === null
                            ? '人均待估算'
                            : `¥${(activity.perPersonEstimate / 100).toFixed(2)} / 人`}
                      </span>
                      {overlapIds.has(activity.id) && <StatusChip tone="warning">时间重叠</StatusChip>}
                      {outOfRange.some(item => item.id === activity.id) && <StatusChip tone="danger">超出行程日期</StatusChip>}
                      {activity.note !== '' && <span className={styles.note}>{activity.note}</span>}
                    </div>
                    <ActionMenu>
                      <Button variant="ghost" onClick={() => openEdit(activity)}>
                        <Pencil size={18} /> 编辑
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void run({ type: 'itinerary.move', activityId: activity.id, direction: 'up' })}
                      >
                        <ChevronUp size={18} /> 上移
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void run({ type: 'itinerary.move', activityId: activity.id, direction: 'down' })}
                      >
                        <ChevronDown size={18} /> 下移
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void run({ type: 'itinerary.remove', activityId: activity.id })}
                      >
                        <Trash2 size={18} /> 删除
                      </Button>
                    </ActionMenu>
                  </li>
                ); })}
              </ul>
            </section>
          ))}
        </div>

        <aside className={styles.summary} aria-label="日程预算摘要" data-expanded={budgetExpanded}><button className={styles.budgetToggle} aria-expanded={budgetExpanded} onClick={() => setBudgetOpen(!budgetOpen)}>日程预算 · {formatMoney(budget.knownActivitiesTotal)} 已知活动<ChevronDown size={16}/></button><div className={styles.budgetDetail}>
          <h2>预算摘要</h2>
          {budget.perMember.some(row => row.baseEstimate !== null) ? <dl>{budget.perMember.filter(row => row.baseEstimate !== null).map(row => <div key={row.memberId}><dt>{trip.members.find(member => member.id === row.memberId)?.name}</dt><dd>方案 {formatMoney(row.baseEstimate!)} → {budget.complete ? '修订' : '已知部分'} {formatMoney(row.revisedEstimate!)}（差额 {formatMoney(row.revisedEstimate! - row.baseEstimate!)}）</dd></div>)}</dl> : null}
          {plan ? <Button variant="secondary" onClick={() => setReplacing(true)}>重新使用方案日程</Button> : null}
          <p className="muted">{plan ? '方案原活动分项 ' + formatMoney(budget.planActivitiesEstimate) : '方案活动基准待确认'}</p>
          <p className="muted">当前已知活动合计 {formatMoney(budget.knownActivitiesTotal)}</p>
          {budget.unknownActivityCount > 0 && (
            <p className={styles.warn}>还有 {budget.unknownActivityCount} 项待估算</p>
          )}
          {budget.includedCount > 0 && (
            <p className="muted">{budget.includedCount} 项费用已含于方案，不重复累计</p>
          )}
          {!budget.complete && (
            <p className="muted">还有未估算的费用，当前显示已知部分。</p>
          )}


        </div>
          {budget.perMember.some((row) => row.overBudget === true) && (
            <div className={styles.warn}>
              日程调整后超出成员预算，尚未重新征求意向。
              <ul>
                {budget.perMember
                  .filter((row) => row.overBudget === true)
                  .map((row) => (
                    <li key={row.memberId}>
                      {trip.members.find((member) => member.id === row.memberId)?.name ?? row.memberId}：
                      修订估算 {formatMoney(row.revisedEstimate ?? 0)}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <Dialog open={replacing} title="替换现有日程？" onClose={() => setReplacing(false)} footer={<Button variant="danger" disabled={busy} onClick={() => { if (!plan) return; setBusy(true); void execute({ type: 'itinerary.replaceFromTemplate', planId: plan.id, confirmed: true }).then(result => { setBusy(false); if (result.ok) setReplacing(false); else setError(result.error.message); }); }}>确认替换日程</Button>}>
        <p>将覆盖 {activities.length} 项安排，手工修改会被替换。账本不受影响。</p>{error ? <ErrorNotice>{error}</ErrorNotice> : null}
      </Dialog>
      <Drawer
        open={editing !== null}
        title={editing?.id ? '编辑安排' : '添加安排'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              保存安排
            </Button>
          </>
        }
      >
        {error !== null && <ErrorNotice>{error}</ErrorNotice>}
        {dateRange === null ? <div className={styles.formRow}>
          <Input label="日程开始日期" type="date" value={draftRange.start} onChange={event => setDraftRange({ ...draftRange, start: event.target.value })}/>
          <Input label="日程结束日期" type="date" value={draftRange.end} onChange={event => setDraftRange({ ...draftRange, end: event.target.value })}/>
        </div> : null}
        <Input
          label="名称"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
        />
        <Input
          label="日期"
          type="date"
          value={form.date}
          min={dateRange?.start ?? draftRange.start}
          max={dateRange?.end ?? draftRange.end}
          onChange={(event) => setForm({ ...form, date: event.target.value })}
        />
        <div className={styles.formRow}>
          <Input
            label="开始时间"
            type="time"
            value={form.startTime}
            onChange={(event) => setForm({ ...form, startTime: event.target.value })}
          />
          <Input
            label="结束时间"
            type="time"
            value={form.endTime}
            onChange={(event) => setForm({ ...form, endTime: event.target.value })}
          />
        </div>
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
        <Select
          label="费用归属"
          value={form.budgetBucket}
          onChange={(event) => {
            const bucket = event.target.value as Activity['budgetBucket'];
            setForm({
              ...form,
              budgetBucket: bucket,
              category: bucket === 'included' ? '交通' : '活动',
            });
          }}
        >
          <option value="activities">计入活动预算</option>
          <option value="included">费用已含于方案（仅记录安排）</option>
        </Select>
        {form.budgetBucket === 'activities' ? (
          <Input
            label="人均预计活动支出（元，留空表示待估算）"
            inputMode="decimal"
            value={form.perPersonEstimate}
            onChange={(event) => setForm({ ...form, perPersonEstimate: event.target.value })}
          />
        ) : (
          <p className="muted">此项费用已含于方案其他分项，不重复计入活动预算。</p>
        )}
        <div className="field">
          <label htmlFor="itinerary-note">备注（可选）</label>
          <textarea
            id="itinerary-note"
            value={form.note}
            maxLength={300}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
          />
        </div>
        <p className="muted">
          <Clock3 size={16} /> 起止时间需同时填写，结束晚于开始；跨午夜请拆成两条。时间重叠仅提示，不阻止保存。
        </p>
      </Drawer>
    </section>
  );
}

// D02 成员编辑表单：字段顺序 昵称 → 出发城市 → 预算上限 → 可用日期 → 偏好。
import { Button, Input } from '../../components/ui';
import type { Id, Member, Range, Trip } from '../../domain/types';
import { DESTINATION_TAG_VOCABULARY } from '../../data/destinations';
import { BUDGET_CAP_MAX } from '../../domain/planning/profile';
import styles from './squad.module.css';

export interface MemberDraft {
  name: string;
  originCity: string;
  budgetCap: string; // 表单文本；'' 表示未知；'0' 表示明确零预算
  availability: Range[];
  preferences: string[];
}

export function draftFromMember(member?: Member): MemberDraft {
  return {
    name: member?.name ?? '',
    originCity: member?.originCity ?? '',
    budgetCap: member?.budgetCap === null || member?.budgetCap === undefined ? '' : String(member.budgetCap / 100),
    availability: member?.availability?.length ? member.availability.map((r) => ({ ...r })) : [{ start: '', end: '' }],
    preferences: member?.preferences ?? [],
  };
}

/** 元文本 → 分；返回 null 表示未知；非法返回 undefined。 */
function parseBudgetToCents(text: string): number | null | undefined {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return undefined;
  const [yuan, fraction = ''] = value.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > BUDGET_CAP_MAX) return undefined;
  return cents;
}

export function MemberEditor({ draft, onChange, errors }: {
  draft: MemberDraft;
  onChange: (draft: MemberDraft) => void;
  errors: Record<string, string>;
}) {
  const updateRange = (index: number, patch: Partial<Range>) => {
    const availability = draft.availability.map((range, i) => (i === index ? { ...range, ...patch } : range));
    onChange({ ...draft, availability });
  };
  const toggleTag = (tag: string) => {
    const preferences = draft.preferences.includes(tag)
      ? draft.preferences.filter((t) => t !== tag)
      : [...draft.preferences, tag];
    onChange({ ...draft, preferences });
  };

  return (
    <div className={styles.form}>
      <Input data-profile-field="name" label="昵称" value={draft.name} error={errors.name} maxLength={40}
        onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      <Input data-profile-field="originCity" label="出发城市（未知可留空）" value={draft.originCity} error={errors.originCity} list="city-suggestions"
        onChange={(event) => onChange({ ...draft, originCity: event.target.value })} />
      <datalist id="city-suggestions">
        {['上海', '杭州', '南京', '北京', '广州', '成都', '武汉', '西安', '厦门', '青岛'].map((city) => <option key={city} value={city} />)}
      </datalist>
      <Input data-profile-field="budgetCap" label="预算上限（元，留空为待补充；0 表示零预算）" value={draft.budgetCap}
        error={errors.budgetCap} inputMode="decimal"
        onChange={(event) => onChange({ ...draft, budgetCap: event.target.value })} />
      <fieldset className={styles.fieldset}>
        <legend>可用日期区间</legend>
        {draft.availability.map((range, index) => (
          <div className={styles.rangeRow} key={index}>
            <Input data-profile-field="availability" label={`第 ${index + 1} 段起日`} type="date" value={range.start} error={errors[`availability.${index}`]}
              onChange={(event) => updateRange(index, { start: event.target.value })} />
            <Input label="止日" type="date" value={range.end}
              onChange={(event) => updateRange(index, { end: event.target.value })} />
            {draft.availability.length > 1 ? (
              <Button variant="ghost" aria-label={`删除第 ${index + 1} 段日期`}
                onClick={() => onChange({ ...draft, availability: draft.availability.filter((_, i) => i !== index) })}>删除</Button>
            ) : <span />}
          </div>
        ))}
        {draft.availability.length < 5 ? (
          <Button variant="secondary" onClick={() => onChange({ ...draft, availability: [...draft.availability, { start: '', end: '' }] })}>添加日期段</Button>
        ) : <span className={styles.formHint}>最多 5 段可用日期</span>}
      </fieldset>
      <fieldset className={styles.fieldset}>
        <legend>偏好标签（可留空）</legend>
        <div className={styles.preferenceTags}>
          {DESTINATION_TAG_VOCABULARY.map((tag) => (
            <button type="button" key={tag} className={`${styles.tagChip} ${draft.preferences.includes(tag) ? styles.selected : ''}`}
              aria-pressed={draft.preferences.includes(tag)} onClick={() => toggleTag(tag)}>{tag}</button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** 校验编辑草稿，返回字段错误。 */
export function validateDraft(draft: MemberDraft): { errors: Record<string, string>; budgetCap?: number | null } {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 20) errors.name = '昵称需 1～20 字';
  const city = draft.originCity.trim();
  if (city.length > 20) errors.originCity = '城市名过长';
  const budget = parseBudgetToCents(draft.budgetCap);
  if (budget === undefined) errors.budgetCap = '预算需为 ¥0～¥100,000，最多两位小数';
  const ranges = draft.availability;
  if (ranges.length < 1 || ranges.length > 5) errors.availability = '至少 1 段、最多 5 段可用日期';
  ranges.forEach((range, index) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) {
      errors[`availability.${index}`] = '请填写完整起止日期';
    } else if (range.start > range.end) {
      errors[`availability.${index}`] = '起日不得晚于止日';
    }
  });
  return { errors, budgetCap: budget };
}

export function draftToMemberInput(draft: MemberDraft, budgetCap: number | null) {
  return {
    name: draft.name.trim(),
    originCity: draft.originCity.trim() || null,
    budgetCap,
    availability: draft.availability.map((r) => ({ start: r.start, end: r.end })),
    preferences: draft.preferences,
  };
}

export function findBlockingExpenses(trip: Trip, memberId: Id): { id: string; title: string }[] {
  return trip.expenses
    .filter((expense) => expense.payerId === memberId || expense.allocations.some((a) => a.memberId === memberId))
    .map((expense) => ({ id: expense.id, title: expense.title }));
}

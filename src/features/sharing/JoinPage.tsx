import { ExternalShell } from './ExternalShell';
import styles from './external.module.css';
import { useState } from 'react';
import type { ExternalPageProps } from '../../contracts/services';
import type { Plan } from '../../domain/types';
import type { InvitationBody, MemberProfileInput, ResponseBody, SharingEnvelope } from '../../domain/sharing/types';
import { useDecodedEnvelope, useSharingApp } from './useEnvelope';
import { Button, Input, ErrorNotice } from '../../components/ui';
import { formatMoney, parseMoney } from '../../domain/money';
import { memberProfileSchema } from '../../domain/sharing/schema';

const preferences = ['海边', '城市', '人文', '自然', '美食', '摄影'];
export function JoinPage({ data, services }: ExternalPageProps) {
  const decoded = useDecodedEnvelope(data);
  const app = useSharingApp(services);
  const [step, setStep] = useState<'profile' | 'intents' | 'done'>('profile');
  const [name, setName] = useState(''); const [city, setCity] = useState(''); const [budget, setBudget] = useState('');
  const [availability, setAvailability] = useState([{ start: '', end: '' }]);
  const [tags, setTags] = useState<string[]>([]);
  const [intents, setIntents] = useState<Record<string, 'approve' | 'acceptable' | 'decline'>>({});
  const [profile, setProfile] = useState<MemberProfileInput | null>(null);
  const [response, setResponse] = useState<SharingEnvelope<ResponseBody> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  if (!decoded.ok || decoded.envelope.type !== 'invitation') return <ExternalShell><h1>成员填写</h1><ErrorNotice>{decoded.ok ? '这不是成员邀请数据' : decoded.error}</ErrorNotice><a href="#/">返回旅行</a></ExternalShell>;
  const invitation = decoded.envelope as SharingEnvelope<InvitationBody>;
  const body = invitation.body;
  const supported = body.plans.every(plan => services.planning.getTemplate(plan.destinationId, plan.templateVersion).ok);
  function next() {
    const issues: Record<string, string> = {};
    let cents: number | null = null;
    try { cents = budget.trim() ? parseMoney(budget) : null; } catch { issues.budget = '预算请输入最多两位小数的非负金额'; }
    const ranges = availability.filter(range => range.start || range.end);
    if (ranges.some(range => !range.start || !range.end || range.start > range.end)) issues.availability = '每段日期需要填写完整，结束不能早于开始';
    const candidate = { name: name.trim() || body.member.name, originCity: city.trim() || null, budgetCap: cents, availability: ranges, preferences: tags };
    const parsed = memberProfileSchema.safeParse(candidate);
    if (!parsed.success) for (const issue of parsed.error.issues) issues[issue.path[0] === 'budgetCap' ? 'budget' : String(issue.path[0])] = issue.message;
    setErrors(issues);
    if (Object.keys(issues).length || !parsed.success) return;
    setProfile(parsed.data); setStep('intents');
  }
  function generate() {
    if (!profile || !supported) return;
    const result = app.buildResponse(invitation, profile, Object.entries(intents).map(([planId, value]) => ({ planId, value })));
    if (!result.ok) { setErrors({ generate: result.error.message }); return; }
    setResponse(result.value); setStep('done');
  }
  if (step === 'done' && response) {
    const url = app.createShareUrl('response', response);
    return <ExternalShell><h1>反馈已生成</h1><p>把链接或文件发给组织者，由对方预览并导入。</p>
      {url.ok ? <div className="stack"><label>反馈链接<textarea aria-label="反馈链接" readOnly value={url.value} rows={4} onFocus={event => event.target.select()}/></label><Button onClick={() => void app.copyShareUrl(url.value).then(result => setMessage(result.ok ? '已复制' : result.error.message))}>复制反馈链接</Button></div> : <p>链接过长，请下载反馈文件。</p>}
      <div className="recovery-actions"><Button variant="secondary" onClick={() => { const result = app.downloadEnvelope(response, 'response.json'); setMessage(result.ok ? '已请求下载文件' : result.error.message); }}>下载反馈文件</Button><Button variant="ghost" onClick={() => setStep('intents')}>返回修改</Button></div>{message ? <p role="status">{message}</p> : null}
    </ExternalShell>;
  }
  return <ExternalShell>
    <h1>{body.tripName}</h1><p>{body.member.name} · 填写后发回组织者</p>
    <div className={styles.steps} aria-label="填写进度"><span aria-current={step === 'profile' ? 'step' : undefined}>个人资料</span><span aria-current={step === 'intents' ? 'step' : undefined}>方案意向</span></div>
    {!supported ? <ErrorNotice>邀请使用的估算模板版本暂不支持，请联系组织者重新生成邀请。</ErrorNotice> : null}
    {step === 'profile' ? <section className="empty-state">
      <Input label="昵称" value={name} placeholder={body.member.name} onChange={event => setName(event.target.value)} error={errors.name}/>
      <Input label="出发城市" value={city} onChange={event => setCity(event.target.value)} error={errors.originCity}/>
      <Input label="预算上限（元，选填）" value={budget} inputMode="decimal" onChange={event => setBudget(event.target.value)} error={errors.budget}/>
      <fieldset><legend>可用日期（选填）</legend>{availability.map((range, index) => <div className="stack" key={index}>
        <Input label={'可用开始日期 ' + (index + 1)} type="date" value={range.start} onChange={event => setAvailability(current => current.map((item, i) => i === index ? { ...item, start: event.target.value } : item))}/>
        <Input label={'可用结束日期 ' + (index + 1)} type="date" value={range.end} onChange={event => setAvailability(current => current.map((item, i) => i === index ? { ...item, end: event.target.value } : item))}/>
      </div>)}{errors.availability ? <p className="field-error">{errors.availability}</p> : null}{availability.length < 5 ? <Button variant="ghost" onClick={() => setAvailability(ranges => [...ranges, { start: '', end: '' }])}>增加日期区间</Button> : null}</fieldset>
      <fieldset><legend>偏好</legend><div className="toolbar">{preferences.map(tag => <Button key={tag} variant={tags.includes(tag) ? 'primary' : 'secondary'} aria-pressed={tags.includes(tag)} onClick={() => setTags(current => current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag])}>{tag}</Button>)}</div></fieldset>
      <Button onClick={next} disabled={!supported}>查看方案</Button>
    </section> : <section className="stack">
      {body.plans.map(entry => {
        const transport = entry.estimate.manualTransport;
        const member = { ...profile!, id: body.member.id };
        const plan: Plan = { id: entry.id, version: entry.version, destinationId: entry.destinationId, templateVersion: entry.templateVersion, startDate: entry.startDate, days: entry.days,
          estimate: { lodgingPerNight: entry.estimate.lodgingPerNight, foodPerDay: entry.estimate.foodPerDay, activities: entry.estimate.activities, reserve: entry.estimate.reserve,
            transportByMember: { [member.id]: transport && transport.originCity === member.originCity ? { originCity: transport.originCity, amount: transport.amountCents } : null } } };
        const evaluation = supported ? services.planning.evaluatePersonalPlan({ member, plan }) : null;
        return <article className="empty-state" key={entry.id}><h2>{entry.destinationName}</h2><p>{entry.startDate} 起 {entry.days} 天</p>
          <p>{evaluation?.total !== null && evaluation?.total !== undefined ? '个人估算 ' + formatMoney(evaluation.total) : '交通待组织者补充'}</p>
          {evaluation?.reasons.length ? <ul>{evaluation.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : <p>时间与预算满足</p>}
          <div className="toolbar" role="group" aria-label={entry.destinationName + '意向'}>{(['approve', 'acceptable', 'decline'] as const).map(value => <Button key={value} variant={intents[entry.id] === value ? 'primary' : 'secondary'} aria-pressed={intents[entry.id] === value} onClick={() => setIntents(current => ({ ...current, [entry.id]: value }))}>{({ approve: '赞成', acceptable: '可接受', decline: '不参加' })[value]}</Button>)}</div>
        </article>;
      })}
      {errors.generate ? <ErrorNotice>{errors.generate}</ErrorNotice> : null}<div className="toolbar"><Button variant="secondary" onClick={() => setStep('profile')}>返回修改</Button><Button onClick={generate} disabled={!supported}>生成反馈</Button></div>
    </section>}
  </ExternalShell>;
}

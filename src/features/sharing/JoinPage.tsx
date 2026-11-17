import { useState } from 'react';
import type { ExternalPageProps } from '../../contracts/services';
import { buildResponseEnvelope } from '../../domain/sharing';
import type { InvitationBody, MemberProfileInput, ResponseIntentEntry } from '../../domain/sharing/types';
import { useDecodedEnvelope, useSharingApp } from './useEnvelope';
import { Button, Input, ErrorNotice } from '../../components/ui';
import { formatMoney } from '../../domain/money';

type Step = 'profile' | 'intents' | 'done';

const PREFERENCE_OPTIONS = ['海边', '城市', '人文', '自然', '美食', '摄影'];

export function JoinPage({ data, services }: ExternalPageProps) {
  const decoded = useDecodedEnvelope(data);
  const app = useSharingApp(services);
  const [step, setStep] = useState<Step>('profile');
  const [profile, setProfile] = useState<MemberProfileInput>({
    name: '',
    originCity: null,
    budgetCap: null,
    availability: [],
    preferences: [],
  });
  const [cityText, setCityText] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [availStart, setAvailStart] = useState('');
  const [availEnd, setAvailEnd] = useState('');
  const [intents, setIntents] = useState<Record<string, ResponseIntentEntry['value']>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [responseUrl, setResponseUrl] = useState<string | null>(null);
  const [responseJson, setResponseJson] = useState<string | null>(null);

  if (!decoded.ok) {
    return (
      <div className="external-page">
        <h1>成员填写</h1>
        <ErrorNotice>{decoded.error}</ErrorNotice>
        <a href="#/" className="button button-secondary">返回</a>
      </div>
    );
  }

  const envelope = decoded.envelope;
  if (envelope.type !== 'invitation') {
    return (
      <div className="external-page">
        <h1>成员填写</h1>
        <ErrorNotice>这不是成员邀请数据（类型：{envelope.type}）</ErrorNotice>
        <a href="#/" className="button button-secondary">返回</a>
      </div>
    );
  }

  const invitation = envelope.body as InvitationBody;

  function validateProfile(): boolean {
    const next: Record<string, string> = {};
    if (!profile.name.trim()) next.name = '请填写昵称';
    if (profile.name.trim().length > 20) next.name = '昵称最多 20 字';
    if (budgetText && !/^\d+(\.\d{1,2})?$/.test(budgetText)) next.budget = '请输入有效金额';
    if (availStart && availEnd && availStart > availEnd) next.availability = '起日不能晚于止日';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleNext() {
    if (!validateProfile()) return;
    setProfile((prev) => ({
      ...prev,
      originCity: cityText.trim() || null,
      budgetCap: budgetText ? Math.round(parseFloat(budgetText) * 100) : null,
      availability: availStart && availEnd ? [{ start: availStart, end: availEnd }] : [],
    }));
    setStep('intents');
  }

  async function handleGenerate() {
    const finalProfile: MemberProfileInput = {
      ...profile,
      originCity: cityText.trim() || null,
      budgetCap: budgetText ? Math.round(parseFloat(budgetText) * 100) : null,
      availability: availStart && availEnd ? [{ start: availStart, end: availEnd }] : [],
    };
    const intentList = Object.entries(intents).map(([planId, value]) => ({ planId, value }));
    const result = buildResponseEnvelope(
      envelope as Parameters<typeof buildResponseEnvelope>[0],
      finalProfile,
      intentList,
      { payloadId: services.createId(), now: services.now() },
    );
    if (!result.ok) { setErrors({ generate: result.error.message }); return; }
    const url = app.createShareUrl('response', result.value);
    if (url.ok) {
      setResponseUrl(url.value);
    } else {
      setResponseJson(JSON.stringify(result.value, null, 2));
    }
    setStep('done');
  }

  if (step === 'done') {
    return (
      <div className="external-page">
        <h1>反馈已生成</h1>
        <p style={{ color: 'var(--color-muted)' }}>把链接或文件发给组织者，由对方导入。不会自动提交到任何地方。</p>
        {responseUrl && (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>反馈链接</label>
            <textarea
              readOnly
              value={responseUrl}
              style={{ width: '100%', minHeight: '80px', padding: '8px', fontSize: '13px', fontFamily: 'monospace' }}
              onFocus={(e) => e.target.select()}
            />
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <Button onClick={() => { void navigator.clipboard?.writeText(responseUrl); }}>复制链接</Button>
              <Button variant="secondary" onClick={() => { window.location.hash = `#/response?data=${encodeURIComponent(responseUrl.split('data=')[1] ?? '')}`; }}>
                查看反馈页
              </Button>
            </div>
          </div>
        )}
        {responseJson && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ color: 'var(--color-warning)', fontSize: '14px' }}>链接过长，请下载反馈文件发送给组织者</p>
            <Button onClick={() => {
              const blob = new Blob([responseJson], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = 'feedback.json'; a.click();
              URL.revokeObjectURL(url);
            }}>下载反馈文件</Button>
          </div>
        )}
        <div style={{ marginTop: '16px' }}>
          <Button variant="secondary" onClick={() => setStep('intents')}>返回修改</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="external-page" style={{ maxWidth: '720px' }}>
      <header style={{ marginBottom: '24px' }}>
        <p style={{ color: 'var(--color-muted)', fontSize: '14px' }}>填写后发回组织者</p>
        <h1>{invitation.tripName}</h1>
        <p style={{ color: 'var(--color-muted)' }}>你好，{invitation.member.name}</p>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          <span style={{ padding: '4px 12px', borderRadius: '16px', fontSize: '13px', background: step === 'profile' ? 'var(--color-primary)' : 'var(--color-primary-soft)', color: step === 'profile' ? 'white' : 'var(--color-primary)' }}>1. 个人资料</span>
          <span style={{ padding: '4px 12px', borderRadius: '16px', fontSize: '13px', background: step === 'intents' ? 'var(--color-primary)' : 'var(--color-primary-soft)', color: step === 'intents' ? 'white' : 'var(--color-primary)' }}>2. 方案意向</span>
        </div>
      </header>

      {step === 'profile' && (
        <section style={{ background: 'white', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '24px' }}>
          <Input
            label="昵称"
            value={profile.name}
            onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
            error={errors.name}
            placeholder="你的昵称"
            maxLength={20}
          />
          <Input
            label="出发城市"
            value={cityText}
            onChange={(e) => setCityText(e.target.value)}
            placeholder="例如：上海"
          />
          <Input
            label="预算上限（元，选填）"
            value={budgetText}
            onChange={(e) => setBudgetText(e.target.value)}
            error={errors.budget}
            placeholder="例如：1500"
            inputMode="decimal"
          />
          <div className="field">
            <label>可用日期（选填）</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="date" value={availStart} onChange={(e) => setAvailStart(e.target.value)} style={{ flex: 1 }} />
              <span>至</span>
              <input type="date" value={availEnd} onChange={(e) => setAvailEnd(e.target.value)} style={{ flex: 1 }} />
            </div>
            {errors.availability && <span className="field-error">{errors.availability}</span>}
          </div>
          <div className="field">
            <label>偏好（可多选）</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {PREFERENCE_OPTIONS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setProfile((p) => ({
                    ...p,
                    preferences: p.preferences.includes(tag) ? p.preferences.filter((t) => t !== tag) : [...p.preferences, tag],
                  }))}
                  style={{
                    padding: '6px 16px', borderRadius: '20px', border: '1px solid var(--color-border)',
                    background: profile.preferences.includes(tag) ? 'var(--color-primary)' : 'white',
                    color: profile.preferences.includes(tag) ? 'white' : 'inherit', cursor: 'pointer',
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleNext} style={{ width: '100%' }}>查看方案</Button>
        </section>
      )}

      {step === 'intents' && (
        <section>
          <p style={{ color: 'var(--color-muted)', marginBottom: '16px' }}>对每个候选方案表达你的意向</p>
          {invitation.plans.map((plan) => (
            <div key={plan.id} style={{ background: 'white', border: '1px solid var(--color-border)', borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '8px' }}>{plan.destinationName}</h3>
              <p style={{ color: 'var(--color-muted)', fontSize: '14px', margin: '0 0 12px' }}>
                {plan.startDate} 起 {plan.days} 天 · {plan.destinationTags.join('、')}
              </p>
              {plan.estimate.manualTransport && (
                <p style={{ fontSize: '13px', color: 'var(--color-muted)' }}>
                  交通估算：{formatMoney(plan.estimate.manualTransport.amountCents)}（{plan.estimate.manualTransport.originCity} 出发）
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                {(['approve', 'acceptable', 'decline'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setIntents((prev) => ({ ...prev, [plan.id]: value }))}
                    style={{
                      flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid var(--color-border)',
                      background: intents[plan.id] === value ? 'var(--color-primary)' : 'white',
                      color: intents[plan.id] === value ? 'white' : 'inherit', cursor: 'pointer', fontSize: '14px',
                    }}
                  >
                    {value === 'approve' ? '赞成' : value === 'acceptable' ? '可接受' : '不参加'}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {errors.generate && <ErrorNotice>{errors.generate}</ErrorNotice>}
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button variant="secondary" onClick={() => setStep('profile')}>返回修改</Button>
            <Button onClick={handleGenerate} style={{ flex: 1 }}>生成反馈</Button>
          </div>
        </section>
      )}
    </div>
  );
}

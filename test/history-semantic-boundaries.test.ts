import assert from 'node:assert/strict'
import { it } from 'node:test'
import { HistoryQueries } from '../src/game/history-query'
import { HistoryRecorder } from '../src/game/history-recorder'
import { HERO } from '../src/heroes'

it('puts recorded round-start effects before speeches and ballots, with specific heir wording', () => {
  const query = new HistoryQueries({} as any) as any
  const header = { mode: 'classic', participants: [{ tenureId: 'a', seat: 1, identity: { nickname: 'Alice' } }, { tenureId: 'b', seat: 2, identity: { nickname: 'Bob' } }] }
  const phase = { round: 2, kind: 'regular', speeches: [{ tenureId: 'a', text: '正常发言' }], ballots: [{ voterTenureId: 'a', targetSeat: 2, weight: 2 }], effectiveVotes: [], events: [
    { kind: 'hero-reveal', tenureId: 'a', heroId: HERO.DUO_ER_GUN, timing: 'round-start' },
    { kind: 'skill', tenureId: 'a', heroId: 1, effect: '获得1个“伐”标记', targetSeats: [], timing: 'round-start' },
    { kind: 'skill', tenureId: 'a', heroId: 10, effect: '指定传弟对象，等待其选择', targetSeats: [2], timing: 'resolution' },
  ] }
  const result = query.phaseLines(header, phase)
  const text = [...result.speechLines, ...result.tailLines].join('\n')
  assert.ok(text.indexOf('获得1个') < text.indexOf('投给了'))
  assert.ok(text.indexOf('亮出武将牌') < text.indexOf('正常发言'))
  const content = query.phaseContent(header, phase).toString()
  assert.ok(content.indexOf('获得1个') < content.indexOf('正常发言'))
  assert.match(text, /选择将技能传给2号玩家Bob，等待对方选择/)
  assert.doesNotMatch(text, /发动武将技能/)
})

it('records an earned reward in its original phase after the next phase starts', () => {
  const r = new HistoryRecorder({ gameId: '00000000-0000-4000-8000-000000000001', platform: 'sandbox', selfId: 'bot', guildId: 'group', sandbox: true, mode: 'classic', startedAt: 0, host: { platform: 'sandbox', userId: 'host', nickname: 'Host' }, ruleVersion: 'test', rules: {} })
  r.join(1, { platform: 'sandbox', userId: 'alice', nickname: 'Alice' }, 'good', 1, 0)
  const sequence = r.beginPhase('first', 1, 'regular', [1])
  r.beginPhase('second', 2, 'regular', [1])
  r.event(1, { kind: 'skill', heroId: 1, effect: '获得1个“伐”标记', targetSeats: [] }, { sequence, timing: 'round-end' })
  const data = r.finish({ kind: 'aborted', reason: 'host-stop' }, 1)
  assert.equal(data.phases[0].events[0].timing, 'round-end')
  assert.equal(data.phases[1].events.length, 0)
})

it('renders each currently emitted skill family without a generic activation placeholder', () => {
  const query = new HistoryQueries({} as any) as any
  const header = { mode: 'classic', participants: [{ tenureId: 'a', seat: 1, identity: { nickname: 'Alice' } }, { tenureId: 'b', seat: 2, identity: { nickname: 'Bob' } }] }
  const effects = ['守卫连带出局', '获得1个“权”标记', '觉醒，获得1个“伐”标记',
    '获得“援寡”效果：参与加时时不能发动“权计”', '入关，获得“摄政”', '发动“专镇”，守卫自己', '觉醒，获得“西迁”',
    '摄政换票', '因减票选择超时，本次不减票', '迟投增加1票', '传弟选择超时，放弃接受', '因带人选择超时，放弃发动技能',
    '通过“缉访”查看目标的被投票情况，获知：没有玩家投给他', '伐异获得1个伐', '发动“抵诽”，本次得票数减少1票',
    '定策保护：减票1', '放弃旧有投票，退还本阶段已用的1个“伐”标记，并撤销对应额外票权', '获得1个“伐”标记',
    '权计选择超时，进入加时', '放权给2号玩家代投', '避实抵消1票；本人投票失效', '放弃本次缉访', '放弃本次放权',
    '选择缉访选项1，等待本次投票结算', '选择缉访选项2，等待本次投票结算', '指定放权对象，等待代投',
    '发动“放权”，由2号玩家Bob代为使用1个“伐”标记，本次投票数增加1票', '消耗1个权，减票1', '放弃本次减票',
    '放弃发动“传弟”', '指定传弟对象，等待其选择', '传弟被放弃', '传弟：Bob恢复原生技能', '传弟：获得处决',
    '传弟：处决次数+1', '传弟：诬诽次数+1', '传弟：专镇次数+1', '放弃发动技能', '出局带走', '处决被保护抵消',
    '处决：命中异阵营', '处决：自裁', '处决：同阵营反噬', '放弃发动“权计”', '“权计”被保护抵消', '权计指定出局',
    '放弃守卫', '更换守卫目标', '设置守卫目标', '转移定策', '设置定策', '配置摄政', '放弃发动“落梅”', '赠予1个伐']
  for (const effect of effects) {
    const phase = { round: 1, kind: 'regular', speeches: [], ballots: [], effectiveVotes: [], events: [
      { kind: 'skill', tenureId: 'a', heroId: HERO.ZHU_YOU_XIAO, effect, targetSeats: [2] },
    ] }
    const text = query.phaseLines(header, phase).tailLines.join('\n')
    assert.ok(text.length > 0, effect)
    assert.doesNotMatch(text, /发动武将技能/, effect)
  }
})

it('merges an unchanged delegation result but preserves actual changes and cancellations', () => {
  const query = new HistoryQueries({} as any) as any
  const header = { mode: 'classic', participants: [{ tenureId: 'a', seat: 1, identity: { nickname: 'Alice' } }, { tenureId: 'b', seat: 2, identity: { nickname: 'Bob' } }] }
  const events = ['指定放权对象，等待代投', '放弃本次放权', '指定放权对象，等待代投', '放权给2号玩家代投']
    .map(effect => ({ kind: 'skill', tenureId: 'a', heroId: HERO.ZHU_YOU_XIAO, effect, targetSeats: [2] }))
  const text = query.phaseLines(header, { round: 1, kind: 'regular', speeches: [], ballots: [], effectiveVotes: [], events }).tailLines.join('\n')
  assert.equal(text, '1号玩家Alice将本次投票交给2号玩家Bob决定。\n1号玩家Alice放弃本次放权。\n1号玩家Alice将本次投票交给2号玩家Bob代投。')
})

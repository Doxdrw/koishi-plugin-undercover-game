import { h } from "koishi"
import { pathToFileURL } from "url"
import { resolve } from "path"

/**
 * 武将配置模块
 *
 * 该模块集中管理所有武将的元数据（名称、技能描述、卡面图片）。
 * 武将在游戏内通过「索引」来标识，索引顺序即为下方 HEROES 数组的顺序，
 * 索引同时用于对局历史与技能注册，已有索引保持稳定：
 *
 *   0 张献忠 / 1 李自成 / 2 朱由检 / 3 吴三桂 / 4 皇太极
 *   5 袁崇焕 / 6 林丹汗 / 7 史可法 / 8 毛文龙 / 9 多尔衮
 *
 * 新增武将需同步元数据、技能模块与注册、结算时序、卡面和回归测试。
 */

export interface HeroDef {
  /** 武将名称 */
  name: string
  /** 技能描述（用于「查询武将」「叫人」以及补位发牌时的提示） */
  ability: string
  /**
   * 卡面图片文件名（位于插件目录的 ../uc-pics/ 下，不含扩展名）。
   * 默认与武将名一致，即「{name}卡面」。
   */
  cardImageBase?: string
}

export const HEROES: HeroDef[] = [
  {
    name: "张献忠",
    ability: "殒阵：你因投票或武将技能出局，且游戏仍继续时，可以指定场上一名玩家出局。主持人踢人、主动退出、发言超时和选词超时不触发。",
  },
  {
    name: "李自成",
    ability:
      "流兵：投票阶段，若你可以投票，且未对场上玩家投出有效的票，则你获得X个伐标记（X为你本轮可投票数）。\n注：一般可以通过弃票发动技能。未来得及投票、投出的票失效均可发动技能。\n“伐”标记说明：投票阶段，你可以使用任意数量的“伐”，使自己的投票数得到等量的增加。",
  },
  {
    name: "朱由检",
    ability:
      "处决：限定技，发言阶段，可以指定一人，如果此人与你不是同阵营，其出局；否则你出局（若你为白板，则你算作好人阵营）。在群里发“处决”+玩家序号使用该技能。",
  },
  {
    name: "吴三桂",
    ability:
      "权计：加时阶段开始前，你可以选择一名加时的玩家出局，随后跳过加时直接进入下一轮。\n自立：觉醒技，轮次开始时，若你发动过“权计”且发动次数小于X，则你获知场上所有投过你的玩家，获得X个伐标记，并获得“援寡”（X为场上投过你的玩家数量）。\n援寡：每轮开始时，你随机获得下列效果之一：\n1你参与加时时不能发动“权计”；\n2你发动“权计”的下一轮不能投票；\n3若你前一轮发动了“权计”，则本轮无法发动。",
  },
  {
    name: "皇太极",
    ability:
      "集权：如果你投票的玩家（加时阶段投票除外）在下一轮开始前出局，则你获得一个“权”标记；投票结束时，若你的“权”足够多，你会先获得投票分布情况，并可以消耗“权”减少一位玩家的得票数。",
  },
  {
    name: "袁崇焕",
    ability:
      "守卫：投票阶段，你可以守卫一名玩家本轮不会出局或进入加时（不能连续两轮守卫同一名玩家，若你不是白板，你不能守卫自己）。如果被守卫的玩家投你，则守卫失效；游戏仍继续时，你在本轮结算末尾、下轮开始前因反噬出局。你为白板时先结算反噬，再判定苟赢。",
  },
  {
    name: "林丹汗",
    ability:
      "避实：锁定技，游戏开始时，你记录场上除你之外的所有玩家。当有玩家对你造成不利行为（投票或发动技能），移去“避实”中对该玩家的记录并防止之。从第二轮起，每轮开始时，你查看“避实”中记录的玩家情况。\n转进：觉醒技，你第一次受到致命伤害并由于“避实”而存活后，你获得“西迁”。\n西迁：你只能选择“避实”中记录的玩家投票，且如果你投票的对象也投了你，则你的投票失效。",
  },
  {
    name: "史可法",
    ability:
      "忠烈：投票结束后，你获知是否有队友投了你。\n抵诽：如果有队友投票给你，则你的得票数减1；如果你投给了队友，你失去此技能。\n落梅：你因投票或武将技能出局，且游戏仍继续时，可以赠予一名玩家X枚“伐”标记（X=本局初始非好人数量-你发动抵诽的次数）。",
  },
  {
    name: "毛文龙",
    ability:
      "据岛：锁定技，投票阶段，你不能投票。询问谁没投票时，你不会出现在名单中。\n塘报：投票阶段结束时，若你未处于加时状态且你的投票可以改变结果，你查看得票情况。然后你可以投票给任意可被投票的玩家，此投票视为无来源。",
  },
  {
    name: "多尔衮",
    ability:
      "定策：投票阶段，你可以指定一名其他玩家获得“定策”标记（若场上已有“定策”标记，则改为移动给该玩家）。直到本轮结束，本轮获得“定策”标记的玩家得票数始终减少1。若成功减票，对方获知之。\n入关：觉醒技，轮次开始时，若你至少发动过两次“定策”，或已有玩家因非投票原因而出局，你亮出武将牌并获得“摄政”，且在场上有“定策”标记时你无法再发动“定策”。\n摄政：若场上有“定策”标记的玩家未经该技能指定过，你可以指定一名玩家A在下次得票唯一最多时同另一名玩家B票数互换（A与B必须是两名不同玩家，且“定策”标记从轮次开始时在A或B身上）。换票成功后，你失去所有技能。",
  },
]

/** 武将数量（等价于原 hero_num） */
export const HERO_NUM = HEROES.length

/** 武将名称列表（等价于原 hero_name） */
export const HERO_NAMES: string[] = HEROES.map((hero) => hero.name)

/** 武将技能描述列表（等价于原 hero_ability） */
export const HERO_ABILITIES: string[] = HEROES.map((hero) => hero.ability)

/** 返回包内只读默认卡面的绝对路径。 */
export function heroDefaultCardPath(dirname: string, heroName: string): string {
  const def = HEROES.find((hero) => hero.name === heroName)
  const base = def?.cardImageBase ?? `${heroName}卡面`
  return resolve(dirname, "../uc-pics/" + base + ".png")
}

/**
 * 生成武将卡面图片消息元素。
 * @param dirname 插件运行目录（传入 __dirname）
 * @param heroName 武将名称
 */
export function heroCardImage(dirname: string, heroName: string) {
  return h.image(pathToFileURL(heroDefaultCardPath(dirname, heroName)).href)
}

/**
 * 武将索引常量。
 * 游戏内所有 heros[]、hs.flagN[] 等数组都以「武将索引」作为下标，
 * 使用这些常量代替魔法数字 0~9，可显著提升可读性。
 *
 * 例：heros[HERO.LIN_DAN_HAN] 即「林丹汗所在的玩家序号」。
 */
export const HERO = {
  /** 0 张献忠：出局带人 */
  ZHANG_XIAN_ZHONG: 0,
  /** 1 李自成：弃票得伐 / 用伐增票 */
  LI_ZI_CHENG: 1,
  /** 2 朱由检：处决（限定技） */
  ZHU_YOU_JIAN: 2,
  /** 3 吴三桂：权计 / 自立 / 援寡 */
  WU_SAN_GUI: 3,
  /** 4 皇太极：权标记减票 */
  HUANG_TAI_JI: 4,
  /** 5 袁崇焕：守卫 */
  YUAN_CHONG_HUAN: 5,
  /** 6 林丹汗：避实 / 转进 / 西迁 */
  LIN_DAN_HAN: 6,
  /** 7 史可法：忠烈 / 抵诽 / 落梅 */
  SHI_KE_FA: 7,
  /** 8 毛文龙：据岛 / 塘报 */
  MAO_WEN_LONG: 8,
  /** 9 多尔衮：定策 / 入关 / 摄政 */
  DUO_ER_GUN: 9,
} as const

/**
 * 武将运行时状态。
 *
 * 这五个数组均以「武将索引(0~9)」为下标并行存储，原先散落为
 * flag_heros / flag_heros_2 / flag_heros_3 / flag_heros_4 / flag_heros_5，
 * 现统一收纳到本对象中：
 *
 *   flag1 / flag2 / flag4 —— 数值标记
 *   flag3 / flag5       —— 列表标记（存放玩家序号，部分场景用正负号区分状态）
 *
 * 各槽位对于不同武将含义不同，详见各武将技能结算逻辑中的注释。
 */
export interface HeroState {
  flag1: number[]
  flag2: number[]
  flag3: number[][]
  flag4: number[]
  flag5: number[][]
}

/** 创建/重置一局的武将状态。 */
export function createHeroState(heroNum: number): HeroState {
  return {
    flag1: Array(heroNum).fill(0),
    flag2: Array(heroNum).fill(0),
    flag3: Array.from({ length: heroNum }, () => [] as number[]),
    flag4: Array(heroNum).fill(0),
    flag5: Array.from({ length: heroNum }, () => [] as number[]),
  }
}

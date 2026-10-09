import { HEROES } from "../heroes"
import { HeroRegistry } from "../game/hero-module"
import { duoErGunModule } from "./duo-er-gun"
import { huangTaiJiModule } from "./huang-tai-ji"
import { linDanHanModule } from "./lin-dan-han"
import { liZiChengModule } from "./li-zi-cheng"
import { maoWenLongModule } from "./mao-wen-long"
import { shiKeFaModule } from "./shi-ke-fa"
import { wuSanGuiModule } from "./wu-san-gui"
import { zhangXianZhongModule } from "./zhang-xian-zhong"
import { yuanChongHuanModule } from "./yuan-chong-huan"
import { zhuYouJianModule } from "./zhu-you-jian"

export const heroRegistry = new HeroRegistry(HEROES)
  .register(zhangXianZhongModule)
  .register(liZiChengModule)
  .register(zhuYouJianModule)
  .register(yuanChongHuanModule)
  .register(shiKeFaModule)
  .register(duoErGunModule)
  .register(huangTaiJiModule)
  .register(wuSanGuiModule)
  .register(linDanHanModule)
  .register(maoWenLongModule)

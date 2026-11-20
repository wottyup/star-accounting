# 分类图标目录

现有 123 个 WebP 图标按用途分成下列 17 个文件夹，其中 37 个消费分类图标及 8 个借款与财务图标裁剪自用户提供的透明图标表。这两批图片采用 256×256 透明画布，保持比例与统一留白。

| 文件夹 | 大类 | 图片数 |
| --- | --- | ---: |
| [food-drink](./food-drink/) | 餐饮食品 | 17 |
| [shopping-clothing](./shopping-clothing/) | 购物穿搭 | 6 |
| [transport-travel](./transport-travel/) | 交通出行 | 12 |
| [home-living](./home-living/) | 居家生活 | 20 |
| [personal-care](./personal-care/) | 个人护理 | 2 |
| [family-pets](./family-pets/) | 家庭宠物 | 6 |
| [healthcare](./healthcare/) | 医疗健康 | 5 |
| [sports-outdoors](./sports-outdoors/) | 运动户外 | 3 |
| [education-entertainment](./education-entertainment/) | 文教娱乐 | 8 |
| [digital](./digital/) | 数码通讯与数字服务 | 17 |
| [gifts-social](./gifts-social/) | 人情往来与公益 | 7 |
| [income](./income/) | 收入 | 11 |
| [fund-transfers](./fund-transfers/) | 转账与贷款还款 | 2 |
| [finance-fees](./finance-fees/) | 保险税费 | 2 |
| [tobacco](./tobacco/) | 烟草 | 1 |
| [payment-platforms](./payment-platforms/) | 支付平台 | 3 |
| [common](./common/) | 通用图标 | 1 |

## 后续补充图标

- 把新图片放入对应的大类文件夹，沿用小写英文文件名；AI 订阅、API 等数字消费图片可放入 `digital/`。
- 记账分类的资源映射位于 `app/src/lib/stark/utils/category-icon.ts`；仅增加图片文件不会自动增加应用分类。
- 分类候选同时用于手动记账和截图识别。新增类别时需同步 Go、Ktor 截图识别提示词；数字消费目前分别提供 AI 订阅与 API、游戏购买与游戏充值等细分类别。
- 支付平台图标由 `app/src/lib/stark/utils/platform-icons.ts` 及相关页面引用。
- 共享图标只保存一份。例如医疗与药品共用 `healthcare/yaopin.webp`。奖金、理财、转账、贷款还款已使用专属图标。
- `common/` 保留“其他”通用图标；`finance-fees/` 存放保险、税费手续费图标。

## 借款与财务图标

| 类别 | 资源 |
| --- | --- |
| 借出 | `gifts-social/lend.webp` |
| 借入 | `gifts-social/borrow.webp` |
| 收回借款 | `gifts-social/collect-loan.webp` |
| 归还借款 | `gifts-social/repay-personal-loan.webp` |
| 奖金 | `income/bonus.webp` |
| 理财 | `income/investment.webp` |
| 转账 | `fund-transfers/transfer.webp` |
| 贷款还款 | `fund-transfers/loan-repayment.webp` |

既有“还款”名称及 `REPAYMENT` 流水使用贷款还款图标。`TRANSFER` 流水明确标注个人借款四项名称时显示对应方向，其余转账使用通用转账图标。

借出、借入、收回借款、归还借款均位于记账分类的“人情公益”大类，支出和收入选择器均可浏览这四项。选择借出/归还借款时按支出保存，借入/收回借款按收入保存；沿用现有收支统计规则，尚未新增借款余额关联。

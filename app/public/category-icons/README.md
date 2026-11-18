# 分类图标目录

现有 78 个 WebP 图标按用途分成下列 15 个文件夹。此目录仅整理图片资源；应用里的分类名称与记账方式保持原有行为。

| 文件夹 | 大类 | 图片数 |
| --- | --- | ---: |
| [food-drink](./food-drink/) | 餐饮食品 | 13 |
| [shopping-clothing](./shopping-clothing/) | 购物穿搭 | 4 |
| [transport-travel](./transport-travel/) | 交通出行 | 9 |
| [home-living](./home-living/) | 居家生活 | 17 |
| [personal-care](./personal-care/) | 个人护理 | 2 |
| [family-pets](./family-pets/) | 家庭宠物 | 2 |
| [healthcare](./healthcare/) | 医疗健康 | 2 |
| [sports-outdoors](./sports-outdoors/) | 运动户外 | 3 |
| [education-entertainment](./education-entertainment/) | 文教娱乐 | 5 |
| [digital](./digital/) | 数码通讯与数字服务 | 4 |
| [gifts-social](./gifts-social/) | 人情往来 | 2 |
| [income](./income/) | 收入 | 9 |
| [finance-fees](./finance-fees/) | 保险税费 | 2 |
| [payment-platforms](./payment-platforms/) | 支付平台 | 3 |
| [common](./common/) | 通用图标 | 1 |

## 后续补充图标

- 把新图片放入对应的大类文件夹，沿用小写英文文件名；AI 订阅、API 等数字消费图片可放入 `digital/`。
- 记账分类的资源映射位于 `app/src/lib/stark/utils/category-icon.ts`；仅增加图片文件不会自动增加应用分类。
- 支付平台图标由 `app/src/lib/stark/utils/platform-icons.ts` 及相关页面引用。
- 共享图标只保存一份。例如 `home-living/jiajulei1.webp` 由家电与理财共用，`shopping-clothing/wanju.webp` 由玩具与奖金共用，`digital/dianzilei.webp` 由通讯与转账共用。保持既有映射，避免因目录归属改变旧账单图标。
- `common/` 保留“其他”通用图标；`finance-fees/` 存放保险、税费手续费图标。

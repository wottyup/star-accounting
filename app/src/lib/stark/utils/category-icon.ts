import type { Transaction } from "@/lib/stark/models";

const APP_BASE_PATH = (process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "").replace(/\/+$/, "");
const withAppBasePath = (path: string) => APP_BASE_PATH ? `${APP_BASE_PATH}${path}` : path;

const categoryIconFiles: Record<string, string> = {
  餐饮: "food-drink/canyinlei.webp",
  购物: "shopping-clothing/gouwulei.webp",
  交通: "transport-travel/gongongchuxing.webp",
  住房: "home-living/zhufang.webp",
  娱乐: "education-entertainment/youxilei.webp",
  医疗: "healthcare/yaopin.webp",
  日用: "home-living/qingjie.webp",
  服装: "shopping-clothing/fuzhuanglei.webp",
  美容: "personal-care/gerenhuli-optimized.webp",
  宠物: "family-pets/chongwu-optimized.webp",
  通讯: "digital/dianzilei.webp",
  运动: "sports-outdoors/jianshenlei.webp",
  教育: "education-entertainment/jiaoyulei.webp",
  工资: "income/gongjulei.webp",
  奖金: "shopping-clothing/wanju.webp",
  理财: "home-living/jiajulei1.webp",
  转账: "digital/dianzilei.webp",
  还款: "income/gongjulei.webp",
  其他: "common/qita.webp",
  保险: "finance-fees/baoxian.webp",
  红包: "gifts-social/hongbao.webp",
  房租: "home-living/fangzu.webp",
  公交地铁: "transport-travel/gongjiaoditie.webp",
  会员订阅: "digital/huiyuandingyue.webp",
  打车: "transport-travel/dache.webp",
  买菜: "food-drink/maicai.webp",
  母婴: "family-pets/muying.webp",
  税费手续费: "finance-fees/shuifei-shouxvfei.webp",
  外卖: "food-drink/waimai.webp",
  报销: "income/baoxiao.webp",
  补贴: "income/butie.webp",
  二手转卖: "income/ershouzhuanmai.webp",
  兼职: "income/jianzhi.webp",
  经营收入: "income/jinyingshouru.webp",
  利息分红: "income/lixif-fenhong.webp",
  退款: "income/tuikuan.webp",
  租金: "income/zujin.webp",
  充电: "transport-travel/chongdian-optimized.webp",
  出行: "transport-travel/chuxinglei.webp",
  打印: "education-entertainment/dayin-optimized.webp",
  电费: "home-living/dianfei-optimized.webp",
  电子产品: "digital/dianzichanp-optimized.webp",
  工具: "home-living/gongju.webp",
  户外: "sports-outdoors/huwai.webp",
  个人护理: "personal-care/gerenhuli-optimized.webp",
  家具: "home-living/jiajulei.webp",
  家电: "home-living/jiajulei1.webp",
  家政: "home-living/jiazheng.webp",
  酒类: "food-drink/jiulei.webp",
  加油: "transport-travel/jiayou-optimized.webp",
  理发: "personal-care/lifa-optimized.webp",
  礼物: "gifts-social/liwu.webp",
  旅游: "transport-travel/lvyou-optimized.webp",
  门诊: "healthcare/menz-optimized.webp",
  汽车保养: "transport-travel/qichebaoyang.webp",
  清洁: "home-living/qingjie.webp",
  清洁优化: "home-living/qingjie-optimized.webp",
  燃气: "home-living/ranqi.webp",
  日常清洁: "home-living/richangqingjie-optimized.webp",
  肉类: "food-drink/roulei.webp",
  生活用品: "home-living/shenghuoyongzhi-optimized.webp",
  水产: "food-drink/shuicanlei.webp",
  水费: "home-living/shuifei.webp",
  水果: "food-drink/shuiguo.webp",
  糖果: "food-drink/tangguo.webp",
  甜品: "food-drink/tianpinlei.webp",
  停车费: "transport-travel/tingchefei-optimized.webp",
  体育: "sports-outdoors/tiyulei.webp",
  图书: "education-entertainment/tushulei.webp",
  玩具: "shopping-clothing/wanju.webp",
  闲食: "food-drink/xianshi.webp",
  下午茶: "food-drink/xiawucha.webp",
  鞋类: "shopping-clothing/xielei.webp",
  烟草: "food-drink/yancaplei.webp",
  药品: "healthcare/yaopin.webp",
  影音: "education-entertainment/yingyinlei.webp",
  饮品: "food-drink/niunai.webp",
  花圃: "home-living/zhiwu.webp",
  装修: "home-living/zhuangxiulei.webp",
  网费: "digital/wangfei-optimized.webp",
  维修: "home-living/weixiu.webp",
  物业费: "home-living/wuyefei.webp",
};

const nonExpenseCategories = new Set([
  "工资", "奖金", "理财", "报销", "补贴", "二手转卖", "兼职", "经营收入", "利息分红", "退款", "租金", "转账", "还款",
]);
const expenseCategoryOrder = [
  // 餐饮食品
  "餐饮", "外卖", "买菜", "闲食", "水果", "肉类", "水产", "糖果", "甜品", "下午茶", "饮品", "酒类", "烟草",
  // 购物服饰与宠物
  "购物", "服装", "鞋类", "美容", "个人护理", "理发", "宠物", "母婴", "玩具", "礼物", "红包",
  // 交通出行
  "交通", "公交地铁", "打车", "出行", "旅游", "加油", "充电", "汽车保养", "停车费",
  // 住房与日用
  "住房", "房租", "物业费", "家具", "家电", "装修", "水费", "电费", "燃气", "网费", "清洁", "清洁优化", "日常清洁", "家政", "维修", "日用", "生活用品",
  // 数码通讯
  "通讯", "电子产品", "影音", "打印",
  // 医疗健康
  "医疗", "药品", "门诊",
  // 运动户外
  "体育", "户外",
  // 教育与娱乐
  "教育", "图书", "娱乐", "会员订阅",
  // 其他
  "工具", "保险", "税费手续费", "花圃", "其他",
];

const orderedExpenseCategories = Array.from(new Set([
  ...expenseCategoryOrder,
  ...Object.keys(categoryIconFiles),
]));

const visibleExpenseCategories = orderedExpenseCategories.filter(
  (category) => !nonExpenseCategories.has(category),
);

export const expenseCategoryOptions = [
  ...visibleExpenseCategories.filter((category) => category !== "其他"),
  "其他",
];

const incomeCategoryIcons: Record<string, string> = {
  工资: "income/gongjulei.webp",
  奖金: "shopping-clothing/wanju.webp",
  理财: "home-living/jiajulei1.webp",
  报销: "income/baoxiao.webp",
  补贴: "income/butie.webp",
  二手转卖: "income/ershouzhuanmai.webp",
  兼职: "income/jianzhi.webp",
  经营收入: "income/jinyingshouru.webp",
  利息分红: "income/lixif-fenhong.webp",
  退款: "income/tuikuan.webp",
  租金: "income/zujin.webp",
};

const categoryKeywordIcons: Array<[RegExp, string]> = [
  [/保险/, "finance-fees/baoxian.webp"],
  [/红包/, "gifts-social/hongbao.webp"],
  [/礼物|礼品/, "gifts-social/liwu.webp"],
  [/家政/, "home-living/jiazheng.webp"],
  [/保养|洗车/, "transport-travel/qichebaoyang.webp"],
  [/维修|修理/, "home-living/weixiu.webp"],
  [/物业/, "home-living/wuyefei.webp"],
  [/水果/, "food-drink/shuiguo.webp"],
  [/肉/, "food-drink/roulei.webp"],
  [/水产|海鲜/, "food-drink/shuicanlei.webp"],
  [/糖果|零食/, "food-drink/tangguo.webp"],
  [/甜品|蛋糕/, "food-drink/tianpinlei.webp"],
  [/下午茶/, "food-drink/xiawucha.webp"],
  [/酒/, "food-drink/jiulei.webp"],
  [/烟|香烟|烟草/, "food-drink/yancaplei.webp"],
  [/餐|美食|咖啡/, "food-drink/canyinlei.webp"],
  [/自行车|骑行|摩托|汽车|打车|出租|自驾/, "transport-travel/gongongchuxing.webp"],
  [/公交|地铁/, "transport-travel/gongongchuxing.webp"],
  [/交|车/, "transport-travel/gongongchuxing.webp"],
  [/购|百货|超市|充值/, "shopping-clothing/gouwulei.webp"],
  [/影音|视频|电影/, "education-entertainment/yingyinlei.webp"],
  [/娱|文化|休闲/, "education-entertainment/youxilei.webp"],
  [/日用|生活|清洁/, "home-living/qingjie.webp"],
  [/医|健康|药/, "healthcare/yaopin.webp"],
  [/水费/, "home-living/shuifei.webp"],
  [/燃气|煤气/, "home-living/ranqi.webp"],
  [/住|房|租/, "home-living/zhufang.webp"],
  [/旅/, "transport-travel/chuxinglei.webp"],
  [/宠/, "family-pets/chongwu-optimized.webp"],
  [/服/, "shopping-clothing/fuzhuanglei.webp"],
  [/鞋/, "shopping-clothing/xielei.webp"],
  [/通|信用卡|手机/, "digital/dianzilei.webp"],
  [/耳机|音频/, "education-entertainment/yingyinlei.webp"],
  [/运动|体育/, "sports-outdoors/jianshenlei.webp"],
  [/户外/, "sports-outdoors/huwai.webp"],
  [/工|薪资|薪酬/, "income/gongjulei.webp"],
  [/奖|红利|分红/, "shopping-clothing/wanju.webp"],
  [/理财|投资/, "home-living/jiajulei1.webp"],
  [/教/, "education-entertainment/jiaoyulei.webp"],
  [/书|阅读/, "education-entertainment/tushulei.webp"],
  [/转|退款|收入/, "digital/dianzilei.webp"],
];

const categoryIconPath = (file: string) => withAppBasePath(`/category-icons/${file}`);
const fallbackCategoryIcon = categoryIconPath("common/qita.webp");

function incomeIconFile(category: string): string | null {
  const normalized = category.trim();
  if (incomeCategoryIcons[normalized]) return incomeCategoryIcons[normalized];
  if (/工|薪资|薪酬/.test(normalized)) return incomeCategoryIcons.工资;
  if (/奖|红利|分红/.test(normalized)) return incomeCategoryIcons.奖金;
  if (/理财|投资/.test(normalized)) return incomeCategoryIcons.理财;
  return null;
}

export function categoryIconSrcForCategory(category: string, type?: Transaction["type"]): string {
  if (type === "TRANSFER" || type === "REPAYMENT") {
    return categoryIconPath(categoryIconFiles[type === "TRANSFER" ? "转账" : "还款"]);
  }
  const normalized = category.trim();
  if (categoryIconFiles[normalized]) return categoryIconPath(categoryIconFiles[normalized]);
  if (type === "INCOME") {
    const incomeIcon = incomeIconFile(normalized);
    if (incomeIcon) return categoryIconPath(incomeIcon);
  }
  const matched = categoryKeywordIcons.find(([matcher]) => matcher.test(normalized));
  if (matched) return categoryIconPath(matched[1]);
  return fallbackCategoryIcon;
}

export function categoryIconSrc(item: Transaction): string {
  if (item.type === "TRANSFER" || item.type === "REPAYMENT") {
    return categoryIconPath(categoryIconFiles[item.type === "TRANSFER" ? "转账" : "还款"]);
  }
  const normalized = item.category.trim();
  if (categoryIconFiles[normalized]) return categoryIconPath(categoryIconFiles[normalized]);
  if (item.type === "INCOME") {
    const incomeIcon = incomeCategoryIcons[normalized];
    if (incomeIcon) return categoryIconPath(incomeIcon);
  }
  return fallbackCategoryIcon;
}

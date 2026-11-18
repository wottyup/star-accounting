import { withAppBasePath } from "@/lib/stark/runtime";

const shoppingPlatformLogoFiles = [
  { matches: ["天猫", "tmall"], file: "tmall.webp" },
  { matches: ["淘宝", "taobao"], file: "taobao.webp" },
  { matches: ["京东", "jd.com"], file: "jd.webp" },
  { matches: ["拼多多", "pinduoduo"], file: "pinduoduo.webp" },
  { matches: ["1688", "阿里巴巴"], file: "1688.webp" },
  { matches: ["小象", "xiaoxiang"], file: "xiaoxiang-supermarket.webp" },
  { matches: ["盒马", "hema", "freshippo"], file: "hema.webp" },
];

export function shoppingPlatformIconSrc(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  const match = shoppingPlatformLogoFiles.find(({ matches }) =>
    matches.some((alias) => normalized.includes(alias.toLocaleLowerCase())),
  );
  return match ? withAppBasePath(`/shopping-platform-icons/${match.file}`) : null;
}

export function paymentPlatformIconSrc(value: string | null | undefined) {
  const normalized = value?.trim().toLocaleLowerCase();
  if (!normalized) return null;
  if (normalized.includes("支付宝") || normalized.includes("alipay")) {
    return withAppBasePath("/category-icons/payment-platforms/zhifubao.webp");
  }
  if (normalized.includes("微信") || normalized.includes("wechat") || normalized.includes("weixin")) {
    return withAppBasePath("/category-icons/payment-platforms/weixin.webp");
  }
  if (normalized.includes("银行卡") || normalized.includes("银联") || normalized.includes("银行") || normalized.includes("bank")) {
    return withAppBasePath("/category-icons/payment-platforms/unionpau.webp");
  }
  return null;
}

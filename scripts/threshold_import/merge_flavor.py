"""
将 FlavorNet 开源嗅觉数据集中的风味描述标签,
与本地 aroma_data_merged.json 中的化合物通过英文名交叉匹配。
为每个物质添加 flavor_desc (英文描述) 和 flavor_categories (中文分类) 字段。

数据来自: https://github.com/pyrfume/pyrfume-data/tree/main/flavornet
"""
import json, csv, io, os, sys

# ---- 英文描述词 -> 中文大类映射 ----
CATEGORY_RULES = {
    "花香": ["flower", "floral", "rose", "jasmine", "violet", "chamomile", "lavender",
             "muguet", "geranium", "hyacinth", "magnolia", "orris", "lilac"],
    "果香": ["fruit", "fruity", "apple", "apricot", "banana", "berry", "cherry",
             "grape", "grapefruit", "lemon", "melon", "orange", "peach", "pear",
             "pineapple", "plum", "strawberry", "raspberry", "citrus", "coconut",
             "watermelon", "prune", "mandarin"],
    "甜香": ["sweet", "honey", "caramel", "vanilla", "chocolate", "cocoa", "sugar",
             "butterscotch", "cotton candy", "marshmallow", "maple", "licorice", "anise"],
    "草本/青绿": ["herb", "green", "grass", "leaf", "hay", "tea", "cucumber",
                  "vegetable", "lettuce", "moss", "basil", "dill", "coriander",
                  "thyme", "fennel", "green tea"],
    "辛香/香料": ["spice", "spicy", "cinnamon", "pungent", "mint", "camphor",
                  "warm", "pepper", "clove", "nutmeg", "caraway", "menthol",
                  "spearmint", "peppermint", "curry", "turpentine"],
    "木质/烟熏": ["wood", "woody", "pine", "smoke", "smoky", "tobacco", "leather",
                  "earth", "earthy", "balsamic", "resin", "tar"],
    "坚果/烘焙": ["nut", "hazelnut", "almond", "roast", "roasted", "coffee", "bread",
                  "popcorn", "malt", "burnt", "baked", "toast", "cocoa",
                  "peanut butter", "walnut"],
    "乳脂/奶油": ["cream", "butter", "buttery", "dairy", "cheese", "milk", "biscuit"],
    "硫化/葱蒜": ["sulfur", "garlic", "onion", "cabbage", "horseradish", "mustard",
                  "putrid", "fish", "truffle", "thiamin"],
    "酒香": ["wine", "alcohol", "brandy", "cognac", "rum", "whiskey", "fermented"],
    "化学/溶剂": ["solvent", "gasoline", "medicine", "phenol", "metal", "chemical",
                  "rubber", "plastic", "paint", "alkane", "ether", "acid", "pesticide"],
    "脂肪/蜡质": ["fat", "fatty", "oil", "oily", "wax", "waxy", "tallow", "soap",
                   "rancid"],
    "动物/肉味": ["meat", "beef", "roast beef", "cooked meat", "sweat", "fecal",
                  "mothball", "animal", "urine"],
}

DESCRIPTOR_CN = {
    "sour":"酸", "pungent":"辛辣", "ether":"醚香", "cream":"奶油", "butter":"黄油",
    "burnt sugar":"焦糖", "almond":"杏仁", "urine":"尿骚", "sweet":"甜", "flower":"花香",
    "green":"青绿", "onion":"洋葱", "fruit":"果香", "medicine":"药味", "cheese":"奶酪",
    "sweat":"汗臭", "rancid":"酸败", "wood":"木质", "herb":"草本", "acid":"酸",
    "sharp":"尖锐", "clove":"丁香", "curry":"咖喱", "phenol":"酚", "plastic":"塑料",
    "fecal":"粪臭", "alkane":"烷烃", "fat":"脂肪", "lemon":"柠檬", "smoke":"烟熏",
    "garlic":"大蒜", "sweet":"甜", "tar":"焦油", "metal":"金属", "cardboard":"纸板",
    "hawthorne":"山楂", "honey":"蜂蜜", "alcohol":"酒精", "soy":"酱油",
    "cabbage":"卷心菜", "gasoline":"汽油", "sulfur":"硫", "paint":"油漆", "fish":"鱼腥",
    "vanilla":"香草", "oil":"油脂", "balsamic":"香脂", "camphor":"樟脑",
    "wax":"蜡", "mint":"薄荷", "rose":"玫瑰", "spice":"香料", "lavender":"薰衣草",
    "wine":"酒", "solvent":"溶剂", "bitter":"苦", "malt":"麦芽", "nut":"坚果",
    "cocoa":"可可", "caramel":"焦糖", "rubber":"橡胶", "grass":"草",
    "soap":"皂", "cream":"奶油", "resin":"树脂", "pine":"松木",
    "turpentine":"松节油", "geranium":"天竺葵", "orange":"橙", "coconut":"椰子",
    "peach":"桃", "apricot":"杏", "apple":"苹果", "banana":"香蕉", "tobacco":"烟草",
    "plum":"李子", "pineapple":"菠萝", "grape":"葡萄", "leaf":"树叶", "earth":"泥土",
    "mushroom":"蘑菇", "coffee":"咖啡", "roasted":"烘烤", "popcorn":"爆米花",
    "roast":"烘烤", "cinnamon":"肉桂", "strawberry":"草莓", "raspberry":"覆盆子",
    "melon":"甜瓜", "cucumber":"黄瓜", "chocolate":"巧克力", "bread":"面包",
    "mustard":"芥末", "horseradish":"辣根", "pepper":"胡椒", "citrus":"柑橘",
    "jasmine":"茉莉", "dill":"莳萝", "licorice":"甘草", "anise":"茴香",
    "pear":"梨", "grapefruit":"葡萄柚", "whiskey":"威士忌", "cognac":"干邑",
    "menthol":"薄荷醇", "spearmint":"留兰香", "peppermint":"薄荷",
    "basil":"罗勒", "fennel":"茴香", "caraway":"葛缕子", "thyme":"百里香",
    "fresh":"清新", "warm":"温暖", "chemical":"化学味", "potato":"马铃薯",
    "tomato":"番茄", "walnut":"核桃", "hazelnut":"榛子",
}

def get_categories(descriptors):
    cats = set()
    desc_lower = [d.strip().lower() for d in descriptors]
    for cat, keywords in CATEGORY_RULES.items():
        for kw in keywords:
            for d in desc_lower:
                if kw in d:
                    cats.add(cat)
                    break
    return sorted(cats)

def translate_descriptors(descriptors):
    result = []
    for d in descriptors:
        d_stripped = d.strip().lower()
        if d_stripped in DESCRIPTOR_CN:
            result.append(DESCRIPTOR_CN[d_stripped])
        else:
            result.append(d.strip())
    return result


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    merged_path = os.path.join(base_dir, "frontend", "public", "aroma_data_merged.json")

    # 读取 FlavorNet CSV (已下载到 data/ 目录)
    mol_path = os.path.join(base_dir, "data", "flavornet_molecules.csv")
    beh_path = os.path.join(base_dir, "data", "flavornet_behavior.csv")

    if not os.path.exists(mol_path) or not os.path.exists(beh_path):
        print("ERROR: 请先将 FlavorNet 的 molecules.csv 和 behavior.csv 文件下载到 data/ 目录！")
        print(f"  期望路径: {mol_path}")
        print(f"  期望路径: {beh_path}")
        sys.exit(1)

    # 解析 molecules.csv -> {CID: name}
    cid_to_name = {}
    with open(mol_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cid = row.get("CID", "").strip()
            name = row.get("name", "").strip().lower()
            if cid and name:
                cid_to_name[cid] = name

    # 解析 behavior.csv -> {CID: "desc1;desc2;..."}
    cid_to_desc = {}
    with open(beh_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cid = row.get("Stimulus", "").strip()
            desc = row.get("Descriptors", "").strip()
            if cid and desc:
                cid_to_desc[cid] = desc

    # 组建: 英文名(小写) -> descriptors
    name_to_flavor = {}
    for cid, name in cid_to_name.items():
        desc_str = cid_to_desc.get(cid, "")
        if desc_str:
            descs = [d.strip() for d in desc_str.split(";") if d.strip()]
            name_to_flavor[name] = descs

    print(f"FlavorNet 数据库共 {len(name_to_flavor)} 条有效记录。")

    # 读取本地 aroma_data
    with open(merged_path, "r", encoding="utf-8") as f:
        aroma_data = json.load(f)

    # 交叉匹配
    matched = 0
    for item in aroma_data:
        en_name = (item.get("english_name") or "").strip().lower()
        descs = name_to_flavor.get(en_name)
        if descs:
            item["flavor_desc"] = descs
            item["flavor_desc_cn"] = translate_descriptors(descs)
            item["flavor_categories"] = get_categories(descs)
            matched += 1
        else:
            item["flavor_desc"] = []
            item["flavor_desc_cn"] = []
            item["flavor_categories"] = []

    # 写回
    with open(merged_path, "w", encoding="utf-8") as f:
        json.dump(aroma_data, f, ensure_ascii=False, indent=2)

    total = len(aroma_data)
    unique_compounds = len(set(item.get("english_name", "").lower() for item in aroma_data if item.get("english_name")))
    unique_matched = len(set(
        item.get("english_name", "").lower()
        for item in aroma_data
        if item.get("flavor_desc")
    ))
    print(f"本地阈值库共 {total} 条记录 ({unique_compounds} 种独立化合物)。")
    print(f"成功匹配风味描述 {matched} 条记录 ({unique_matched} 种独立化合物)。")
    print(f"匹配率: {unique_matched/unique_compounds*100:.1f}%")


if __name__ == "__main__":
    main()

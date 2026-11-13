// 由 macaron/palettes.json 生成。
export const palettes = [
  {
    "id": "mint",
    "code": "A",
    "name": "薄荷奶绿",
    "paper": "#F7FAF5",
    "pastel": "#CDE9D8",
    "ink": "#354C42"
  },
  {
    "id": "peach",
    "code": "B",
    "name": "蜜桃奶杏",
    "paper": "#FFF9F2",
    "pastel": "#F2D4C5",
    "ink": "#62483F"
  },
  {
    "id": "lavender",
    "code": "C",
    "name": "奶油薰衣草",
    "paper": "#FCF9FF",
    "pastel": "#E2D4F3",
    "ink": "#514361"
  },
  {
    "id": "blue",
    "code": "D",
    "name": "海盐奶蓝",
    "paper": "#F6FAFF",
    "pastel": "#CDDEF2",
    "ink": "#3D516B"
  },
  {
    "id": "strawberry",
    "code": "E",
    "name": "草莓奶霜",
    "paper": "#FFF8FA",
    "pastel": "#F3D3DE",
    "ink": "#66464F"
  },
  {
    "id": "banana",
    "code": "F",
    "name": "香蕉奶油",
    "paper": "#FFFDF2",
    "pastel": "#F4E6AE",
    "ink": "#5C5337"
  },
  {
    "id": "pistachio",
    "code": "G",
    "name": "开心果奶",
    "paper": "#FAFBF3",
    "pastel": "#E1E8BE",
    "ink": "#4A543A"
  },
  {
    "id": "latte",
    "code": "H",
    "name": "杏仁拿铁",
    "paper": "#FBF8F3",
    "pastel": "#E6D8C8",
    "ink": "#574B40"
  }
] as const;

export type PaletteId = (typeof palettes)[number]["id"];
export function isPaletteId(value: unknown): value is PaletteId {
  return palettes.some((palette) => palette.id === value);
}

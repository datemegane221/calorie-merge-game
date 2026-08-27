import gyudonImg from "./assets/gyudon.png";
import tonkatsuImg from "./assets/tonkatsu.png";
import yakinikuImg from "./assets/yakiniku.png";
import jiroRamenImg from "./assets/jiro-ramen.png";
import jiroMashimashiImg from "./assets/jiro-mashimashi.png";
import jiroAburaKarameZenbuMashiImg from "./assets/jiro-abura-karame-zenbu-mashi.png";
import densetsuNoJiroImg from "./assets/densetsu-no-jiro.png";

// 進化テーブル。他テーマ（飲み会マージなど）に差し替えやすいよう設定オブジェクトとして分離している。
// radius は物理演算・描画両方で使う半径(px)。image があればそちらを優先して描画し、
// なければ emoji を描画する（画像を用意していない段階は emoji のまま）。
export const FOOD_STAGES = [
  { id: 1, name: "枝豆", emoji: "🫛", calories: 15, radius: 16, color: "#8BC34A" },
  { id: 2, name: "こんにゃく", emoji: "🍢", calories: 20, radius: 22, color: "#D8CBA9" },
  { id: 3, name: "おにぎり", emoji: "🍙", calories: 180, radius: 28, color: "#F5F3EC" },
  { id: 4, name: "から揚げ", emoji: "🍗", calories: 300, radius: 36, color: "#D9772E" },
  { id: 5, name: "牛丼", emoji: "🍲", image: gyudonImg, calories: 700, radius: 44, color: "#A9622D" },
  { id: 6, name: "とんかつ", emoji: "🍖", image: tonkatsuImg, calories: 900, radius: 52, color: "#C97B3D" },
  { id: 7, name: "焼肉", emoji: "🥩", image: yakinikuImg, calories: 1200, radius: 60, color: "#B5432A" },
  // あえてここで一度カロリーが下がる(コミカルな演出)
  { id: 8, name: "ラーメン", emoji: "🍜", calories: 700, radius: 68, color: "#E3B23C" },
  // 進化演出: 画面が揺れる、急激にサイズアップ
  { id: 9, name: "二郎系ラーメン", emoji: "🍜", image: jiroRamenImg, calories: 1500, radius: 80, color: "#D9772E", shakeOnSpawn: true },
  { id: 10, name: "二郎系マシマシ", emoji: "🍜", image: jiroMashimashiImg, calories: 2500, radius: 90, color: "#2D4A3E" },
  { id: 11, name: "二郎系アブラカラメマシマシ全部増し", emoji: "🍜", image: jiroAburaKarameZenbuMashiImg, calories: 3500, radius: 100, color: "#993C1D" },
  // 最終形態。実質1日の摂取カロリー相当として表示するための値(合体はここで終わり)
  { id: 12, name: "伝説の二郎", emoji: "🍜", image: densetsuNoJiroImg, calories: 2200, radius: 112, color: "#D9AF3C", isFinal: true },
];

export const MAX_STAGE_ID = FOOD_STAGES[FOOD_STAGES.length - 1].id;

// 次に落とす食べ物は進化テーブルの下位段階からランダム抽選
export const DROP_POOL_SIZE = 5;
export const DROP_POOL = FOOD_STAGES.slice(0, DROP_POOL_SIZE).map((s) => s.id);

export function stageById(id) {
  return FOOD_STAGES.find((s) => s.id === id);
}

export function randomDropStageId() {
  return DROP_POOL[Math.floor(Math.random() * DROP_POOL.length)];
}

// 成人男性の1日の摂取カロリー(目安)。ゲームオーバー時の換算コメントに使う。
export const DAILY_CALORIE_REFERENCE = 2200;

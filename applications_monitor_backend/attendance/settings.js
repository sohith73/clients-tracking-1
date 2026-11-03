import { Settings } from "./models.js";
export async function getSettings() {
  try {
    return await Settings.findOneAndUpdate(
      { key: "global" },
      { $setOnInsert: { weeklyOffDays: [0], holidays: [] } },
      { upsert: true, new: true, lean: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Settings.findOne({ key: "global" }).lean();
  }
}

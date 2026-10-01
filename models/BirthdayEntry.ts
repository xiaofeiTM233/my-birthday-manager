// models/BirthdayEntry.ts
import { Schema, model, models } from 'mongoose';

const BirthdayEntrySchema = new Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  month: {
    type: Number,
    required: [true, 'Month is required'],
    min: [1, '月份必须在 1-12 之间'],
    max: [12, '月份必须在 1-12 之间'],
  },
  day: {
    type: Number,
    required: [true, 'Day is required'],
    min: [1, '日期必须在 1-31 之间'],
    max: [31, '日期必须在 1-31 之间'],
  },
  label: {
    type: String,
    required: [true, 'Label/Group is required'], // A, B, etc.
    index: true,
  },
  note: { type: String }, // 备注
  createdAt: { type: Date, default: Date.now },
});

// 同一人同一生日不允许重复录入
BirthdayEntrySchema.index({ name: 1, month: 1, day: 1 }, { unique: true });

// 防止热重载重复编译模型
const BirthdayEntry = models.BirthdayEntry || model('BirthdayEntry', BirthdayEntrySchema);

export default BirthdayEntry;

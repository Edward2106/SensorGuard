import mongoose from 'mongoose';
const { Schema } = mongoose;
const userSchema = new Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['ADMIN', 'OPERATOR', 'VIEWER'], required: true },
  disabled: { type: Boolean, default: false },
  version: { type: Number, default: 0 },
}, { timestamps: true, collection: 'auth_users', bufferCommands: false });
const sessionSchema = new Schema({
  _id: String, userId: { type: Schema.Types.ObjectId, required: true, index: true },
  version: Number, expiresAt: { type: Date, required: true, expires: 0 },
}, { collection: 'auth_sessions', bufferCommands: false });
const limitSchema = new Schema({
  _id: String, count: Number, expiresAt: { type: Date, required: true, expires: 0 },
}, { collection: 'auth_limits', bufferCommands: false });
export const User = mongoose.models.AuthUser || mongoose.model('AuthUser', userSchema);
const Session = mongoose.models.AuthSession || mongoose.model('AuthSession', sessionSchema);
const Limit = mongoose.models.AuthLimit || mongoose.model('AuthLimit', limitSchema);
export const authStore = {
  findUser: username => User.findOne({ username }).select('+passwordHash').lean(),
  user: id => User.findById(id).lean(),
  createUser: values => User.create(values),
  users: page => User.find().sort({ _id: 1 }).skip((page - 1) * 50).limit(50).lean(),
  updateUser: (id, values) => User.findByIdAndUpdate(id, { $set: values, $inc: { version: 1 } }, { new: true, runValidators: true }).lean(),
  session: id => Session.findById(id).lean(),
  saveSession: session => Session.create(session),
  revoke: id => Session.deleteOne({ _id: id }),
  async limit(key, maximum, seconds) {
    const bucket = Math.floor(Date.now() / (seconds * 1000));
    const id = `${key}:${bucket}`;
    let result;
    try {
      result = await Limit.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 2) * seconds * 1000) } }, { upsert: true, new: true }).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      result = await Limit.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { new: true }).lean();
    }
    return result.count <= maximum;
  },
};
export async function initializeAuth() { await Promise.all([User.createIndexes(), Session.createIndexes(), Limit.createIndexes()]); }

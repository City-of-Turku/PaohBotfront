import mongoose from 'mongoose';

const { Schema } = mongoose;
const model = new Schema({
    _id: String,
    createdAt: Date,
    updatedAt: Date,
    projectId: String,
    text: String,
    intent: String,
    entities: [{
        start: Number,
        end: Number,
        value: String,
        entity: String,
        _id: false,
    }],
    metadata: { type: Object, required: false },
}, { strict: false });

model.index({ text: 1, projectId: 1 }, { unique: true });
model.index({ createdAt: 1 });

// Used to sort in statistics:
model.index({ 'metadata.canonical': -1 });
model.index({ intent: 1 });

module.exports = mongoose.model('Examples', model, 'examples');

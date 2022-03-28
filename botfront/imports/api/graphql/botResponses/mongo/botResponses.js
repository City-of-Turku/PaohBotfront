import { safeDump, safeLoad } from 'js-yaml/lib/js-yaml';
import shortid from 'shortid';
import BotResponses from '../botResponses.model';
import Forms from '../../forms/forms.model';
import { clearTypenameField, cleanPayload } from '../../../../lib/client.safe.utils';
import { Stories } from '../../../story/stories.collection';
import { addTemplateLanguage, modifyResponseType } from '../../../../lib/botResponse.utils';
import {
    getWebhooks, deleteImages, auditLogIfOnServer, getImageUrls,
} from '../../../../lib/utils';
import { replaceStoryLines } from '../../story/mongo/stories';

const getEntities = (storyLine) => {
    const entitiesString = storyLine.split('{')[1];
    if (!entitiesString) return [];
    const entities = entitiesString.slice(0, entitiesString.length - 1).split(',');
    return entities.map(entity => entity.split(':')[0].replace(/"/g, ''));
};

const parsePayload = (payload) => {
    if (payload[0] !== '/') throw new Error('a payload must start with a "/"');
    const intent = payload.slice(1).split('{')[0];
    const entities = getEntities(payload.slice(1));
    return { intent, entities };
};

const indexResponseContent = (input) => {
    if (Array.isArray(input)) return input.reduce((acc, curr) => [...acc, ...indexResponseContent(curr)], []);
    if (typeof input === 'object') {
        let responseContent = [];
        Object.keys(input).forEach((key) => {
            if (typeof input[key] === 'string' && input[key].length > 0) {
                if (['text', 'title', 'subtitle', 'url'].includes(key)) responseContent.push(input[key].replace(/\n/, ' '));
                if (key === 'payload' && input[key][0] === '/') {
                    const { intent, entities } = parsePayload(input[key]);
                    responseContent.push(intent);
                    entities.forEach(entity => responseContent.push(entity));
                }
            } else if (!input[key]) {
                // pass on null values
            } else {
                responseContent = responseContent.concat(indexResponseContent(input[key]));
            }
        });
        return responseContent;
    }
    return [];
};

export const indexBotResponse = (response) => {
    let responseContent = [];
    responseContent.push(response.key);
    response.values.forEach((value) => {
        value.sequence.forEach((sequence) => {
            responseContent = [...responseContent, ...indexResponseContent(safeLoad(sequence.content))];
        });
    });
    return responseContent.join('\n');
};

const mergeAndIndexBotResponse = async ({
    projectId, language, key, newPayload, index, environment,
}) => {
    const botResponse = await BotResponses.findOne({ projectId, key }).lean();
    if (!botResponse) {
        const textIndex = [key, ...indexResponseContent(newPayload)].join('\n');
        return textIndex;
    }
    const valueIndex = botResponse.values.findIndex(({ lang, env }) => lang === language && env === environment);
    if (valueIndex > -1) { // add to existing language
        botResponse.values[valueIndex].sequence[index] = { content: safeDump(cleanPayload(newPayload)) };
    } else { // add a new language
        botResponse.values = [...botResponse.values, { lang: language, env: environment, sequence: [{ content: safeDump(cleanPayload(newPayload)) }] }];
    }
    return indexBotResponse(botResponse);
};

export const createResponses = async (projectId, responses) => {
    const newResponses = typeof responses === 'string' ? JSON.parse(responses) : responses;
    // eslint-disable-next-line array-callback-return
    const answer = newResponses.map((newResponse) => {
        const properResponse = newResponse;
        properResponse.projectId = projectId;
        properResponse.textIndex = indexBotResponse(newResponse);
        return BotResponses.update({ projectId, key: newResponse.key }, properResponse, { upsert: true });
    });

    return Promise.all(answer);
};

const isResponseNameTaken = async (projectId, key, _id) => {
    if (!key || !projectId) return false;
    if (_id) return !!(await BotResponses.findOne({ projectId, key, _id: { $not: new RegExp(`^${_id}$`) } }).lean());
    return !!(await BotResponses.findOne({ projectId, key }).lean());
};

export const deleteResponse = async (projectId, key, env = 'development') => {
    const response = await BotResponses.findOne({ projectId, key, 'values.env': env }).lean();
    if (!response) return;
    const environments = [...new Set(response.values.map(item => item.env))];
    if (environments.length > 1) {
        const filteredValues = response.values.filter(function (item) { return item.env !== env; });
        await BotResponses.findOneAndUpdate(
            {
                projectId, key,
            },
            { $set: { values: filteredValues } },
            { upsert: true },
        );
        return;
    }
    const { deleteImageWebhook: { url, method } } = getWebhooks();
    if (url && method) deleteImages(getImageUrls(response), projectId, url, method);
    return BotResponses.findOneAndDelete({ _id: response._id }).lean(); // eslint-disable-line consistent-return
};

export const upsertFullResponse = async (projectId, _id, key, newResponse) => {
    const update = newResponse;
    const responseWithNameExists = await isResponseNameTaken(projectId, newResponse.key, _id);
    const textIndex = indexBotResponse(newResponse);
    delete update._id;
    let response;
    if (!('devKeyChange' in newResponse)) {
        newResponse.devKeyChange = false;
    }
    // insert new reponse for dev env while keeping previous for prod env
    if (newResponse.devKeyChange) {
        const newKey = newResponse.key;
        // filter possible production values away since this is response name change to dev env
        update.values = update.values.filter(function (item) { return item.env !== 'production'; });
        response = await BotResponses.findOneAndUpdate(
            { projectId, key: newKey },
            {
                $set: { ...update, textIndex },
                $setOnInsert: {
                    _id: shortid.generate(),
                },
            },
            { runValidators: true, upsert: true },
        ).exec();
        // delete dev env responses from remaining previous response so only prod left
        await deleteResponse(projectId, key, 'development');
    } else {
        response = await BotResponses.findOneAndUpdate(
            { projectId, ...(_id ? { _id } : { key }) },
            {
                $set: { ...update, textIndex },
                $setOnInsert: {
                    _id: shortid.generate(),
                },
            },
            { runValidators: true, upsert: true },
        ).exec();
    }
    
    if (responseWithNameExists) {
        return response;
    }
    const oldKey = response ? response.key : key;
    // if response was inserted
    if (!response) {
        response = await BotResponses.findOne({ key: newResponse.key, projectId }).lean();
    }
    // if response was renamed
    if (!responseWithNameExists && oldKey && oldKey !== newResponse.key) {
        await replaceStoryLines(projectId, oldKey, newResponse.key);
    }
    return { ok: 1, _id: response._id };
};

export const createAndOverwriteResponses = async (projectId, responses) => Promise.all(
    responses.map(({ key, _id = shortid.generate(), ...rest }) => {
        const textIndex = indexBotResponse({ key, _id, ...rest });
        return BotResponses.findOneAndUpdate(
            { projectId, key },
            {
                $set: {
                    projectId, key, ...rest, textIndex,
                },
                $setOnInsert: { _id },
            },
            { new: true, lean: true, upsert: true },
        );
    }),
);

export const getBotResponses = async projectId => BotResponses.find({
    projectId,
}).lean();


export const getBotResponse = async (projectId, key) => BotResponses.findOne({
    projectId,
    key,
}).lean();

export const getBotResponseById = async (_id) => {
    const botResponse = await BotResponses.findOne({
        _id,
    }).lean();
    return botResponse;
};

export const updateResponseType = async ({
    projectId, key, newResponseType, language,
}) => {
    const response = await BotResponses.findOne({ projectId, key }).lean();
    const result = await BotResponses.findOneAndUpdate(
        { projectId, key },
        {
            $set: { values: modifyResponseType(response, newResponseType, language, key).values },
            $setOnInsert: {
                _id: shortid.generate(),
                projectId,
                key,
            },
        },
        { upsert: true },
    );
    return result;
};

export const upsertResponse = async ({
    projectId, language, key, newPayload, index, newKey, env, devKeyChange = false,
}) => {
    const textIndex = await mergeAndIndexBotResponse({
        projectId, language, key: newKey || key, newPayload, index, env,
    });
    const newNameIsTaken = await isResponseNameTaken(projectId, newKey);
    if (newNameIsTaken) throw new Error('E11000'); // response names must be unique
    const update = index === -1
        ? {
            $push: {
                'values.$.sequence': {
                    $each: [{ content: safeDump(cleanPayload(newPayload)) }],
                },
                'values.$.env': env,
            },
            $set: { textIndex, ...(newKey ? { key: newKey } : {}) },
        }
        : {
            $set: {
                [`values.$.sequence.${index}`]: { content: safeDump(cleanPayload(newPayload)) }, 'values.$.env': env, textIndex, ...(newKey ? { key: newKey } : {}),
            },
        };
    let updatedResponse;
    // insert new reponse for dev env while keeping previous for prod env
    if (devKeyChange) {
        updatedResponse = await BotResponses.findOneAndUpdate(
            { projectId, key: newKey },
            {
                $push: { values: { lang: language, env, sequence: [{ content: safeDump(cleanPayload(newPayload)) }] } },
                $setOnInsert: {
                    _id: shortid.generate(),
                    projectId,
                    key: newKey || key,
                    textIndex,
                },
            },
            {
                runValidators: true, new: true, lean: true, upsert: true,
            },
        ).exec();
        // delete dev env responses from remaining previous response so only prod left
        await deleteResponse(projectId, key, env);
    } else {
        updatedResponse = await BotResponses.findOneAndUpdate(
            {
                projectId, key, 'values.lang': language, 'values.env': env,
            },
            update,
            { runValidators: true, new: true, lean: true },
        ).exec().then(result => (
            result
            || BotResponses.findOneAndUpdate(
                { projectId, key },
                {
                    $push: { values: { lang: language, env, sequence: [{ content: safeDump(cleanPayload(newPayload)) }] } },
                    $setOnInsert: {
                        _id: shortid.generate(),
                        projectId,
                        key: newKey || key,
                        textIndex,
                    },
                },
                {
                    runValidators: true, new: true, lean: true, upsert: true,
                },
            )
        ));
    }

    
    if (!newNameIsTaken && updatedResponse && newKey === updatedResponse.key) {
        await replaceStoryLines(projectId, key, newKey);
    }
    return updatedResponse;
};

export const deleteVariation = async ({
    projectId, language, key, index, environment,
}) => {
    const responseMatch = await BotResponses.findOne(
        {
            projectId, key, 'values.lang': language, 'values.env': environment,
        },
    ).exec();
    const sequenceIndex = responseMatch && responseMatch.values.findIndex(({ lang, env }) => lang === language && env === environment);

    const { sequence } = responseMatch.values[sequenceIndex];
    if (!sequence) return null;
    const updatedSequence = [...sequence.slice(0, index), ...sequence.slice(index + 1)];
    responseMatch.values[sequenceIndex].sequence = updatedSequence;
    const textIndex = indexBotResponse(responseMatch);
    return BotResponses.findOneAndUpdate(
        {
            projectId, key, 'values.lang': language, 'values.env': environment,
        },
        { $set: { 'values.$.sequence': updatedSequence, textIndex } },
        { new: true, lean: true },
    );
};

export const newGetBotResponses = async ({
    projectId, template, language, environment = 'development', options = {},
}) => {
    const { emptyAsDefault } = options;
    // template (optional): str || array
    // language (optional): str || array
    let templateKey = {};
    let languageKey = {};
    let languageFilter = [];
    let envKey = {};
    let envFilter = [];
    if (template) {
        const templateArray = typeof template === 'string' ? [template] : template;
        templateKey = { key: { $in: templateArray } };
    }
    if (language) {
        const languageArray = typeof language === 'string' ? [language] : language;
        languageKey = { 'values.lang': { $in: languageArray } };
        languageFilter = [
            {
                $addFields: {
                    values: {
                        $filter: {
                            input: '$values',
                            as: 'value',
                            cond: { $in: ['$$value.lang', languageArray] },
                        },
                    },
                },
            },
        ];
    }
    if (environment) {
        envKey = { 'values.env': environment };
        envFilter = [
            {
                $addFields: {
                    values: {
                        $filter: {
                            input: '$values',
                            as: 'value',
                            cond: { $in: ['$$value.env', [environment]] },
                        },
                    },
                },
            },
        ];
    }
    const aggregationParameters = [

        { $unwind: '$values' },
        { $unwind: '$values.sequence' },
        {
            $project: {
                _id: false,
                key: '$key',
                language: '$values.lang',
                channel: '$values.channel',
                payload: '$values.sequence.content',
                metadata: '$metadata',
            },
        },
    ];

    let templates = await BotResponses.aggregate([
        {
            $match: {
                projectId, ...templateKey, ...languageKey, ...envKey,
            },
        },
        ...languageFilter,
        ...envFilter,
        ...aggregationParameters,
    ]).allowDiskUse(true);

    if ((!templates || !templates.length > 0) && emptyAsDefault) {
        /* replace empty response content with default content
           of the correct response type
        */
        templates = await BotResponses.aggregate([
            { $match: { projectId, ...templateKey } },
            ...aggregationParameters,
        ]).allowDiskUse(true);
        templates = addTemplateLanguage(templates, language);
    }
    return templates;
};

export const deleteResponsesRemovedFromStories = async (removedResponses, projectId) => {
    const sharedResponsesInStories = Stories.find({ projectId, events: { $in: removedResponses } }, { fields: { events: true } }).fetch();
    const formsInProject = await Forms.find({ projectId }).lean();
    const responsesInForms = formsInProject.reduce((acc, value) => [
        ...acc,
        ...value.slots.reduce((allSlots, slot) => [
            ...allSlots,
            `utter_ask_${slot.name}`,
            `utter_valid_${slot.name}`,
            `utter_invalid_${slot.name}`,
        ], [])], []);
    if (removedResponses && removedResponses.length > 0) {
        const deleteResponses = removedResponses.filter((event) => {
            if (sharedResponsesInStories.find(({ events }) => events.includes(event))) return false;
            if (responsesInForms.some(response => response === event)) return false;
            return true;
        });
        deleteResponses.forEach(event => deleteResponse(projectId, event));
        deleteResponses.forEach((response) => {
            auditLogIfOnServer('Deleted response', {
                resId: response._id,
                user: Meteor.user(),
                projectId,
                type: 'deleted',
                operation: 'response-deleted',
                before: { response },
                resType: 'response',
            });
        });
    }
};


export const langToLangResp = async ({
    projectId, key, originLang, destLang, env,
}) => {
    const response = await BotResponses.findOne({ key }).lean();
    const langsValues = response.values;
    const originRespIdx = langsValues.findIndex(langValue => langValue.lang === originLang && langValue.env === env);
    // copy response content to temp array
    const newResponseInDestLang = langsValues[originRespIdx].sequence;
    const destRespIdx = langsValues.findIndex(langValue => langValue.lang === destLang && langValue.env === env);
    // if the lang was already defined we replace it
    if (destRespIdx !== -1) {
        langsValues[destRespIdx] = ({ lang: destLang, sequence: newResponseInDestLang, env });
    } else {
        langsValues.push({ lang: destLang, sequence: newResponseInDestLang, env });
    }
    response.values = langsValues;
    await upsertFullResponse(projectId, response._id, key, response);
    return response;
};

export const deployProdUpdateResponses = async (projectId) => {
    const responses = await getBotResponses(projectId);
    for (const response of responses) {
        response.values = response.values.filter(function (item) { return item.env !== 'production'; });
        if (response.values.length > 0) {
            let newProdValues = [...response.values];
            newProdValues = newProdValues.map(function (item) {
                const temp = Object.assign({}, item);
                temp.env = 'production';
                return temp;
            });
            response.values = response.values.concat(newProdValues);
            const textIndex = indexBotResponse(response);
            await BotResponses.findOneAndUpdate(
                {
                    projectId: response.projectId, key: response.key,
                },
                { $set: { values: response.values, textIndex } },
                { new: true, lean: true },
            ).exec();
        } else {
            await BotResponses.findOneAndDelete({ _id: response._id }).lean();
        }
    }
};

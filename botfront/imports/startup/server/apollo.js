import mongoose from 'mongoose';
import { ApolloServer, AuthenticationError } from 'apollo-server-express';
import { WebApp } from 'meteor/webapp';
import { getUser } from 'meteor/apollo';
import { Accounts } from 'meteor/accounts-base';
import axios from 'axios';
import { processRequest } from 'graphql-upload-minimal';
import { typeDefs, resolvers } from '../../api/graphql/index';
import { can } from '../../lib/scopes';

const handleUploads = options => async (req, res, next) => {
    const contentType = req.headers['content-type'];
    const isUpload = contentType && contentType.startsWith('multipart/form-data');
    if (isUpload) {
        req.body = await processRequest(req, res, options);
    }
    next();
};

const MONGO_URL = process.env.MONGO_URL || `mongodb://localhost:${(process.env.METEOR_PORT || 3000) + 1}/meteor`;

export const connectToDb = () => {
    mongoose.connect(MONGO_URL, {
        keepAlive: 1,
        useUnifiedTopology: 1,
        useFindAndModify: 0,
        useNewUrlParser: 1,
        useCreateIndex: 1,
    });
    mongoose.connection.on('error', () => {
        throw new Error(`unable to connect to database: ${MONGO_URL}`);
    });
};

export const runAppolloServer = () => {
    const server = new ApolloServer({
        typeDefs,
        resolvers,
        uploads: false,
        context: async ({ req }) => {
            const { headers: { authorization } } = req;
            let user = await getUser(authorization);
            const isHealthcheck = (req?.method === 'GET' && req?.query?.query === 'query {healthCheck}');
            if (!isHealthcheck && !user && process.env.API_KEY && process.env.API_KEY !== authorization) throw new AuthenticationError('Unauthorized');
            if (!user) user = Meteor.users.findOne({ username: 'EXTERNAL_CONSUMER' });
            if (!user) {
                Accounts.createUser({ username: 'EXTERNAL_CONSUMER' });
                user = Meteor.users.findOne({ username: 'EXTERNAL_CONSUMER' });
            }
            if (user.username === 'EXTERNAL_CONSUMER' && !can('responses:r', null, user._id)) {
                Meteor.roleAssignment.update(
                    { 'user._id': user._id },
                    { user: { _id: user._id }, scope: null, inheritedRoles: [{ _id: 'responses:r' }] },
                    { upsert: true },
                );
            }
            return ({ user });
        },
    });
    
    WebApp.connectHandlers.use(
        handleUploads({ maxFileSize: 50000000, maxFiles: 100 }),
    );

    server.applyMiddleware({
        app: WebApp.connectHandlers,
        path: '/graphql',
        bodyParserConfig: {
            limit: '50mb',
        },
    });

    WebApp.connectHandlers.use('/graphql', (req, res) => {
        if (req.method === 'GET') {
            res.end();
        }
    });

    WebApp.connectHandlers.use('/health', (req, res) => {
        const { authorization } = req.headers;
        const headersObject = authorization ? {
            headers: {
                authorization,
            },
        } : {};
        axios.get('http://localhost:3000/graphql?query=query%20%7BhealthCheck%7D', headersObject).then((response) => {
            // handle success
            if (response.data) {
                if (response.data && response.data.data && response.data.data.healthCheck) {
                    res.statusCode = 200;
                    res.end();
                }
            } else {
                res.statusCode = 401;
                res.end();
            }
        }).catch(function () {
            res.statusCode = 500;
            res.end();
        });
    });
};

Meteor.startup(() => {
    if (Meteor.isServer) {
        connectToDb();
        runAppolloServer();
    }
});

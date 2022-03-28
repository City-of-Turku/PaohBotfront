import gql from 'graphql-tag';

export const RESP_FROM_LANG = gql`
mutation changelang( $projectId: String!, $key: String!, $originLang: String!, $destLang: String!, $env: String) {
    importRespFromLang(projectId: $projectId, key: $key, originLang: $originLang, destLang: $destLang, env: $env) {
        key
        _id
        projectId
        values {
            env
            lang
            sequence {
                content
            }
        }
  }
}`;

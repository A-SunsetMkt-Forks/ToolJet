import { QueryError, QueryResult, QueryService } from '@tooljet-plugins/common';
import { SourceOptions, QueryOptions } from './types';
import got, { Headers } from 'got';

export default class Baserow implements QueryService {
  authHeader(token: string): Headers {
    return { Authorization: `Token ${token}`, 'Content-Type': 'application/json' };
  }

  async run(sourceOptions: SourceOptions, queryOptions: QueryOptions, dataSourceId: string): Promise<QueryResult> {
    let result = {};
    let response = null;
    const operation = queryOptions.operation;
    const tableId = queryOptions.table_id;
    const apiToken = sourceOptions.api_token;
    try {
      switch (operation) {
        case 'list_rows': {
          response = await got(`https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true`, {
            method: 'get',
            headers: this.authHeader(apiToken),
          });

          result = JSON.parse(response.body);
          break;
        }

        case 'list_fields': {
          response = await got(`https://api.baserow.io/api/database/fields/table/${tableId}/?user_field_names=true`, {
            method: 'get',
            headers: this.authHeader(apiToken),
          });

          result = JSON.parse(response.body);
          break;
        }

        case 'get_row': {
          const row_id = queryOptions.row_id;
          response = await got(
            `https://api.baserow.io/api/database/rows/table/${tableId}/${row_id}/?user_field_names=true`,
            {
              method: 'get',
              headers: this.authHeader(apiToken),
            }
          );

          result = JSON.parse(response.body);
          break;
        }

        case 'create_row': {
          response = await got(`https://api.baserow.io/api/database/rows/table/${tableId}/?user_field_names=true`, {
            method: 'post',
            headers: this.authHeader(apiToken),
            json: JSON.parse(queryOptions.body),
          });

          result = JSON.parse(response.body);
          break;
        }

        case 'update_row': {
          const row_id = queryOptions.row_id;
          response = await got(
            `https://api.baserow.io/api/database/rows/table/${tableId}/${row_id}/?user_field_names=true`,
            {
              method: 'patch',
              headers: this.authHeader(apiToken),
              json: JSON.parse(queryOptions.body),
            }
          );

          result = JSON.parse(response.body);
          break;
        }

        case 'move_row': {
          const row_id = queryOptions.row_id;
          const before_id = queryOptions.before_id;
          response = await got(
            `https://api.baserow.io/api/database/rows/table/${tableId}/${row_id}/move/?user_field_names=true&before_id=${before_id}`,
            {
              method: 'patch',
              headers: this.authHeader(apiToken),
            }
          );

          result = JSON.parse(response.body);
          break;
        }

        case 'delete_row': {
          const row_id = queryOptions.row_id;
          response = await got(`https://api.baserow.io/api/database/rows/table/${tableId}/${row_id}`, {
            method: 'delete',
            headers: this.authHeader(apiToken),
          });

          if (response.statusCode === 204) {
            result = {};
          }
          break;
        }
      }
    } catch (error) {
      console.log(error);
      throw new QueryError('Query could not be completed', error.message, {});
    }
    return {
      status: 'ok',
      data: result,
    };
  }
}

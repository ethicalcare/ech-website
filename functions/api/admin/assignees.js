import { handleAdmin } from '../../../lib/admin/handler.js';
export const onRequest = ({ request, env }) => handleAdmin('assignees', request, env);

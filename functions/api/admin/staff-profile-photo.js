import { handleAdmin } from '../../../lib/admin/handler.js';
export const onRequest = ({ request, env }) => {
  // The hosted text/credential profile boundary cannot attach a photo yet.
  if (request.method === 'POST') return Response.json(
    {error:{code:'disabled',message:'Staff profile photo uploads are not available yet.'}},
    {status:405,headers:{Allow:'GET','Cache-Control':'no-store'}}
  );
  return handleAdmin('staff-profile-photo', request, env);
};

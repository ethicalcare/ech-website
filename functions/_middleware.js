const adminPath = path => path === '/admin' || path.startsWith('/admin/');
export async function onRequest(context) {
 const url=new URL(context.request.url),api=url.pathname.startsWith('/api/admin/');
 let configured;
 try { configured=new URL(context.env.ADMIN_ORIGIN); } catch { if(api||adminPath(url.pathname))return new Response('Staff access is not configured.',{status:503});return context.next(); }
 const onAdmin=url.origin===configured.origin;
 if(api&&!onAdmin)return new Response('Not found',{status:404});
 if(adminPath(url.pathname)&&!onAdmin){url.host=configured.host;url.protocol=configured.protocol;return Response.redirect(url,308);}
 if(!onAdmin)return context.next();
 let response;
 if(url.pathname==='/'){url.pathname='/admin/';response=await context.env.ASSETS.fetch(new Request(url,context.request));}
 else if(api||adminPath(url.pathname))response=await context.next();
 else return new Response('Not found',{status:404});
 const result=new Response(response.body,response);
 result.headers.set('Cache-Control','no-store');result.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
 result.headers.set('X-Content-Type-Options','nosniff');result.headers.set('Referrer-Policy','no-referrer');result.headers.set('X-Frame-Options','DENY');
 result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
 return result;
}

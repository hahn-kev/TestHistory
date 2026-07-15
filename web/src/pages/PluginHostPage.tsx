import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PLUGIN_API_VERSION,
  type PluginToParent,
  type ParentToPlugin,
  type PluginQueryErrorCode,
} from '@testhistory/shared';
import { api, ApiError } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { AppIcon, Card, ErrorBox, Spinner } from '../ui.js';
import { getTheme, themeVars } from '../theme/theme.js';

const MAX_IN_FLIGHT = 4;

/**
 * Hosts a plugin in a sandboxed iframe (opaque origin). The plugin's only
 * capability is the postMessage bridge defined in shared/plugin-protocol:
 * it sends th-query, we relay to the read-only plugin-query API and reply
 * th-result. We accept messages only from this iframe's contentWindow and
 * throttle to MAX_IN_FLIGHT concurrent queries.
 */
export function PluginHostPage() {
  const { id = '', pluginId = '' } = useParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inFlight = useRef(0);
  const project = useAsync(() => api.getProject(id), [id]);
  const signed = useAsync(() => api.pluginUrl(id, pluginId), [id, pluginId]);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    const projectData = project.data?.project;
    if (!projectData) return;

    function post(msg: ParentToPlugin) {
      iframeRef.current?.contentWindow?.postMessage(msg, '*');
    }

    async function onMessage(e: MessageEvent) {
      // Accept only messages from our sandboxed iframe.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const msg = e.data as PluginToParent;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'th-ready') {
        post({
          type: 'th-init',
          apiVersion: PLUGIN_API_VERSION,
          project: { id: projectData!.id, name: projectData!.name },
          theme: { name: getTheme(), vars: themeVars() },
        });
        return;
      }

      if (msg.type === 'th-query') {
        if (inFlight.current >= MAX_IN_FLIGHT) {
          post({ type: 'th-result', id: msg.id, ok: false, error: { code: 'RATE_LIMITED', message: 'Too many concurrent queries.' } });
          return;
        }
        inFlight.current += 1;
        try {
          const result = await api.pluginQuery(id, { sql: msg.sql, params: msg.params });
          post({ type: 'th-result', id: msg.id, ok: true, ...result });
        } catch (err) {
          const code: PluginQueryErrorCode =
            err instanceof ApiError && isPluginErrorCode(err.code) ? (err.code as PluginQueryErrorCode) : 'INTERNAL';
          const message = err instanceof ApiError ? err.message : 'Query failed.';
          post({ type: 'th-result', id: msg.id, ok: false, error: { code, message } });
        } finally {
          inFlight.current -= 1;
        }
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id, project.data]);

  const err = project.error ?? signed.error ?? bridgeError;

  return (
    <div className="space-y-4">
      <div>
        <Link to={`/projects/${id}/settings`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <AppIcon name="arrow-left" className="h-4 w-4" />
          Back to settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-fg">Plugin</h1>
      </div>
      {(project.loading || signed.loading) && <Spinner />}
      {err && <ErrorBox message={err} />}
      {signed.data && (
        <Card className="overflow-hidden p-0">
          <iframe
            ref={iframeRef}
            src={signed.data.url}
            title="plugin"
            sandbox="allow-scripts"
            onError={() => setBridgeError('Failed to load plugin content.')}
            style={{ width: '100%', height: '75vh', border: 'none', background: 'white' }}
          />
        </Card>
      )}
    </div>
  );
}

function isPluginErrorCode(code: string): boolean {
  return ['SQL_ERROR', 'FORBIDDEN_STATEMENT', 'TIMEOUT', 'RESULT_TOO_LARGE', 'RATE_LIMITED', 'INTERNAL'].includes(code);
}

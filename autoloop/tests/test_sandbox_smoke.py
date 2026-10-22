"""One real end-to-end smoke call: claude -p (bare) talks to sandbox/mcp_server.py over stdio, calls describe_data once and
reports the DEV_S row count. Spends real money, so it runs only with LAB_SMOKE=1. The API key comes from the planner's
apiKeyHelper; this test never reads it.

Run: LAB_SMOKE=1 PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider -s tests/test_sandbox_smoke.py
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

AL = Path(__file__).resolve().parents[1]
SERVER = AL / 'sandbox' / 'mcp_server.py'
CALLS = AL / 'sandbox' / 'calls.jsonl'
HELPER = AL / 'planner' / 'anthropic_key_helper.sh'
RECEIPT = AL / 'sandbox' / 'smoke-receipt.json'
BUDGET = 0.15
PROMPT = ('Call the describe_data tool of the lab MCP server exactly once. Then reply with only the DEV_S row count '
          '(splits.dev_s.rows) as a plain integer and nothing else.')


@unittest.skipUnless(os.environ.get('LAB_SMOKE') == '1', 'real Claude call; set LAB_SMOKE=1')
class Smoke(unittest.TestCase):
    def test_describe_data_via_claude(self):
        claude = shutil.which('claude')
        self.assertIsNotNone(claude)
        cwd = Path(tempfile.mkdtemp(prefix='lab-smoke-'))
        cfg = cwd.parent / (cwd.name + '-mcp.json')
        try:
            cfg.write_text(json.dumps({'mcpServers': {'lab': {'type': 'stdio', 'command': sys.executable, 'args': ['-B', str(SERVER)]}}}))
            before = len(CALLS.read_text().splitlines()) if CALLS.exists() else 0
            cmd = [claude, '-p', '--bare', '--settings', json.dumps({'apiKeyHelper': str(HELPER)}),
                   '--mcp-config', str(cfg), '--strict-mcp-config',
                   '--allowedTools', 'mcp__lab__describe_data,mcp__lab__slice_errors,mcp__lab__run_analysis',
                   '--tools', '', '--permission-mode', 'dontAsk', '--max-budget-usd', str(BUDGET),
                   '--output-format', 'json', '--no-session-persistence']
            env = {k: v for k, v in os.environ.items() if k not in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')}
            t0 = time.time()
            p = subprocess.run(cmd, input=PROMPT, capture_output=True, text=True, cwd=cwd, env=env, timeout=300)
            wall = time.time() - t0
        finally:
            shutil.rmtree(cwd, ignore_errors=True)
            cfg.unlink(missing_ok=True)
        self.assertEqual(p.returncode, 0, p.stderr[-2000:])
        out = json.loads(p.stdout)
        new = [json.loads(l) for l in CALLS.read_text().splitlines()[before:]]
        calls = [e for e in new if e.get('event') == 'tools/call']
        hands = [e for e in new if e.get('event') in ('initialize', 'discover')]
        receipt = {'schema': 'AUTOLOOP_SANDBOX_SMOKE/1', 'atEpoch': int(t0), 'wallSeconds': round(wall, 1),
                   'costUsd': out.get('total_cost_usd'), 'numTurns': out.get('num_turns'), 'isError': out.get('is_error'),
                   'subtype': out.get('subtype'), 'result': str(out.get('result'))[:200],
                   'modelUsage': sorted((out.get('modelUsage') or {}).keys()),
                   'handshake': [{k: e.get(k) for k in ('event', 'requested', 'negotiated', 'protocolVersion', 'client', 'clientVersion')} for e in hands],
                   'toolCalls': [{k: e.get(k) for k in ('tool', 'status', 'era', 'protocolVersion', 'textBytes')} for e in calls]}
        RECEIPT.write_text(json.dumps(receipt, indent=1) + '\n')
        print(json.dumps(receipt, indent=1))
        self.assertFalse(out.get('is_error'), out)
        self.assertIn('10701742', re.sub(r'[^0-9]', '', str(out.get('result'))))
        self.assertLessEqual(float(out.get('total_cost_usd') or 0), BUDGET)
        self.assertEqual([c['tool'] for c in calls], ['describe_data'])
        self.assertEqual(calls[0]['status'], 'OK')


if __name__ == '__main__':
    unittest.main()

"""Fixed template behind the slice_errors MCP tool. Its arguments arrive as /job/args.json, already validated on the host."""
import json

import lab_api as L

a = json.loads(open('/job/args.json', 'rb').read())
if a['stat'] == 'residual_quantiles':
    r = L.residual_quantiles(pred_col=a['pred'], keys=a['by'], where=a['where'], min_groups=a['min_groups'])
else:
    r = L.groupby_metrics(a['by'], pred_col=a['pred'], compare_col=a['compare'], where=a['where'], min_groups=a['min_groups'])
L.emit(r)

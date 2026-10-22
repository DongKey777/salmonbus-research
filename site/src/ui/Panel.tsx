import type {ReactNode} from 'react';

export interface PanelProps {
 id?:string;
 title:string;
 subtitle?:string;
 children:ReactNode;
 actions?:ReactNode;
 footer?:ReactNode;
 className?:string;
}

export function Panel({id,title,subtitle,children,actions,footer,className=''}:PanelProps){
 return <section id={id} className={`panel ${className}`}>
  <div className="panel-head"><div><h2>{title}</h2>{subtitle&&<span className="panel-kicker">{subtitle}</span>}</div><div className="panel-actions">{actions}</div></div>
  <div className="panel-body">{children}</div>
  {footer&&<div className="panel-foot">{footer}</div>}
 </section>;
}

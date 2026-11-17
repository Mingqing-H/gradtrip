import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { CalendarDays, Compass, Map, Users, Wallet } from 'lucide-react';
import { Unavailable } from './placeholders/Unavailable';
export function App() {
  return <HashRouter><a className="skip-link" href="#main">跳转主内容</a><div className="shell"><aside className="sidebar"><a className="brand" href="#/"><Compass size={28}/>同路</a><nav aria-label="工作区">{[
    ['squad', '小队', Users], ['plans', '方案', Map], ['itinerary', '日程', CalendarDays], ['ledger', '账本', Wallet],
  ].map(([path, label, Icon]) => <NavLink key={String(path)} to={`/${String(path)}`} className="nav-link">{typeof Icon !== 'string' ? <Icon size={20}/> : null}{String(label)}</NavLink>)}</nav><div className="sidebar-note">毕业旅行<br/>本地工作副本</div></aside><div className="workspace"><header className="topbar"><strong>同路 · 毕业旅行</strong><span className="save-status">基础工程预览</span></header><main id="main" className="content"><Routes><Route path="/" element={<Unavailable title="小队"/>}/>{[['squad', '小队'], ['plans', '方案'], ['itinerary', '日程'], ['ledger', '账本']].map(([path, title]) => <Route key={path} path={path} element={<Unavailable title={title}/>}/>)}<Route path="*" element={<h1>没有找到这个页面</h1>}/></Routes></main></div></div></HashRouter>;
}

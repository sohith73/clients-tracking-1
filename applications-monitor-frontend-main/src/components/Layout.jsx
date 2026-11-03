import React from 'react';

// Page content wrapper. The navigation bar lives in PortalNav, rendered once by App,
// so pages that wrap themselves in <Layout> and pages that do not look the same.
export default function Layout({ children }) {
  return <div className="p-2 md:p-4 bg-slate-50">{children}</div>;
}

import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { ExcelSyncProvider } from '@/components/ExcelSync';
import { RecruitmentProvider } from '@/components/RecruitmentProvider';
export const metadata = {
  title: '알킨스 채용관리',
  description: 'ALKYNES Recruitment Workflow',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <Sidebar />
        <main className="min-h-screen p-4 md:ml-64 md:p-8">
          <RecruitmentProvider>
            <ExcelSyncProvider>{children}</ExcelSyncProvider>
          </RecruitmentProvider>
        </main>
      </body>
    </html>
  );
}

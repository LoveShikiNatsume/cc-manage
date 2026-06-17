import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Sessions from './pages/Sessions';
import Memory from './pages/Memory';
import Usage from './pages/Usage';
import Artifacts from './pages/Artifacts';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/artifacts" element={<Artifacts />} />
        <Route path="/usage" element={<Usage />} />
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Layout>
  );
}

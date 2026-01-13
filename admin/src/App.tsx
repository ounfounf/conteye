import { Refine } from "@refinedev/core";
import { ThemedLayoutV2, useNotificationProvider, RefineThemes } from "@refinedev/antd";
import routerProvider, {
  DocumentTitleHandler,
  UnsavedChangesNotifier,
} from "@refinedev/react-router";
import { BrowserRouter, Routes, Route, Outlet } from "react-router";
import { ConfigProvider, App as AntdApp } from "antd";
import {
  DashboardOutlined,
  CloudServerOutlined,
  ApiOutlined,
  UnorderedListOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons";

import "@refinedev/antd/dist/reset.css";

import { dataProvider } from "./providers/dataProvider";
import { DashboardPage } from "./pages/dashboard";
import { WorkerList, WorkerShow } from "./pages/workers";
import { PeerList, PeerCreate } from "./pages/peers";
import { TaskList, TaskShow } from "./pages/tasks";
import { IngestList, IngestShow, IngestCreate } from "./pages/ingests";

const API_URL = import.meta.env.VITE_API_URL || "/graphql";

function App() {
  return (
    <BrowserRouter>
      <ConfigProvider theme={RefineThemes.Blue}>
        <AntdApp>
          <Refine
            routerProvider={routerProvider}
            dataProvider={dataProvider(API_URL)}
            notificationProvider={useNotificationProvider}
            resources={[
              {
                name: "dashboard",
                list: "/",
                meta: {
                  label: "Dashboard",
                  icon: <DashboardOutlined />,
                },
              },
              {
                name: "workers",
                list: "/workers",
                show: "/workers/:id",
                meta: {
                  label: "Workers",
                  icon: <CloudServerOutlined />,
                },
              },
              {
                name: "peers",
                list: "/peers",
                create: "/peers/create",
                meta: {
                  label: "Peers",
                  icon: <ApiOutlined />,
                },
              },
              {
                name: "tasks",
                list: "/tasks",
                show: "/tasks/:id",
                meta: {
                  label: "Tasks",
                  icon: <UnorderedListOutlined />,
                },
              },
              {
                name: "ingests",
                list: "/ingests",
                show: "/ingests/:id",
                create: "/ingests/create",
                meta: {
                  label: "Ingests",
                  icon: <FolderOpenOutlined />,
                },
              },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
            }}
          >
            <Routes>
              <Route
                element={
                  <ThemedLayoutV2 Title={() => <span style={{ fontSize: 18, fontWeight: 600 }}>ConTeye Admin</span>}>
                    <Outlet />
                  </ThemedLayoutV2>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="/workers">
                  <Route index element={<WorkerList />} />
                  <Route path=":id" element={<WorkerShow />} />
                </Route>
                <Route path="/peers">
                  <Route index element={<PeerList />} />
                  <Route path="create" element={<PeerCreate />} />
                </Route>
                <Route path="/tasks">
                  <Route index element={<TaskList />} />
                  <Route path=":id" element={<TaskShow />} />
                </Route>
                <Route path="/ingests">
                  <Route index element={<IngestList />} />
                  <Route path=":id" element={<IngestShow />} />
                  <Route path="create" element={<IngestCreate />} />
                </Route>
              </Route>
            </Routes>
            <UnsavedChangesNotifier />
            <DocumentTitleHandler />
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}

export default App;

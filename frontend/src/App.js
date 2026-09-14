import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Toaster } from "sonner";
import "@/index.css";

import Landing from "@/pages/Landing";
import { Login, Register } from "@/pages/Auth";
import TutorSearch from "@/pages/TutorSearch";
import TutorProfile from "@/pages/TutorProfile";
import StudentDashboard from "@/pages/StudentDashboard";
import { BookingsList, BookingDetail } from "@/pages/Bookings";
import { TutorDashboard, TutorProfileEdit, TutorAvailability, TutorEarnings } from "@/pages/TutorPages";
import { AdminDashboard, AdminTutors, AdminStudents, AdminBookings } from "@/pages/AdminPages";
import AdminEmailLog from "@/pages/AdminEmailLog";
import Classroom from "@/pages/Classroom";
import Messages from "@/pages/Messages";
import Notifications from "@/pages/Notifications";

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role) && !(roles.includes("admin") && user.role === "super_admin")) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/tutors" element={<TutorSearch />} />
          <Route path="/tutors/:id" element={<TutorProfile />} />
          <Route path="/about" element={<Landing />} />

          {/* Student */}
          <Route path="/student/dashboard" element={<Protected roles={["student"]}><StudentDashboard /></Protected>} />
          <Route path="/student/bookings" element={<Protected roles={["student"]}><BookingsList role="student" /></Protected>} />
          <Route path="/student/bookings/:id" element={<Protected roles={["student"]}><BookingDetail role="student" /></Protected>} />
          <Route path="/student/notifications" element={<Protected roles={["student"]}><Notifications /></Protected>} />
          <Route path="/student/messages" element={<Protected roles={["student"]}><Messages /></Protected>} />

          {/* Tutor */}
          <Route path="/tutor/dashboard" element={<Protected roles={["tutor"]}><TutorDashboard /></Protected>} />
          <Route path="/tutor/profile" element={<Protected roles={["tutor"]}><TutorProfileEdit /></Protected>} />
          <Route path="/tutor/availability" element={<Protected roles={["tutor"]}><TutorAvailability /></Protected>} />
          <Route path="/tutor/bookings" element={<Protected roles={["tutor"]}><BookingsList role="tutor" /></Protected>} />
          <Route path="/tutor/bookings/:id" element={<Protected roles={["tutor"]}><BookingDetail role="tutor" /></Protected>} />
          <Route path="/tutor/earnings" element={<Protected roles={["tutor"]}><TutorEarnings /></Protected>} />
          <Route path="/tutor/messages" element={<Protected roles={["tutor"]}><Messages /></Protected>} />

          {/* Admin */}
          <Route path="/admin/dashboard" element={<Protected roles={["admin", "super_admin"]}><AdminDashboard /></Protected>} />
          <Route path="/admin/tutors" element={<Protected roles={["admin", "super_admin"]}><AdminTutors /></Protected>} />
          <Route path="/admin/students" element={<Protected roles={["admin", "super_admin"]}><AdminStudents /></Protected>} />
          <Route path="/admin/bookings" element={<Protected roles={["admin", "super_admin"]}><AdminBookings /></Protected>} />
          <Route path="/admin/emails" element={<Protected roles={["admin", "super_admin"]}><AdminEmailLog /></Protected>} />

          {/* Live classroom (Jitsi) — accessible by student or tutor of the booking */}
          <Route path="/classroom/:id" element={<Protected roles={["student", "tutor", "admin", "super_admin"]}><Classroom /></Protected>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

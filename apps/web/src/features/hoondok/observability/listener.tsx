"use client";
import { useEffect } from "react";
import { reportClientError } from "./report";

export function HoondokErrorListener() {
  useEffect(() => {
    const report = () => reportClientError("unhandled");
    window.addEventListener("error", report);
    window.addEventListener("unhandledrejection", report);
    return () => {
      window.removeEventListener("error", report);
      window.removeEventListener("unhandledrejection", report);
    };
  }, []);
  return null;
}

import type { APIRoute } from "astro";
import pongHtml from "../../pong.html?raw";

export const prerender = true;

export const GET: APIRoute = () =>
    new Response(pongHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });

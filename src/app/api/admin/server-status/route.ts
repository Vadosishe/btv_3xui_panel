import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { xuiGetServerStatus } from '@/lib/xui';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const status = await xuiGetServerStatus();
    if (!status) {
      return NextResponse.json({ success: false, error: 'Не удалось получить статус 3X-UI сервера' }, { status: 502 });
    }

    return NextResponse.json({ success: true, status });
  } catch (error: any) {
    console.error('Error in server status route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

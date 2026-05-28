import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { xuiGetInbounds } from '@/lib/xui';

// Получить список инбаундов напрямую из 3XUI
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const inbounds = await xuiGetInbounds();
    
    // Форматируем список инбаундов для удобного отображения в селекторах
    const formattedInbounds = inbounds.map((inbound: any) => ({
      id: inbound.id,
      remark: inbound.remark,
      port: inbound.port,
      protocol: inbound.protocol,
      nodeId: inbound.nodeId || 0,
      enable: inbound.enable,
    }));

    return NextResponse.json({ success: true, inbounds: formattedInbounds });
  } catch (error: any) {
    console.error('Error fetching inbounds from XUI:', error.message);
    return NextResponse.json({ success: false, error: 'Не удалось загрузить инбаунды с сервера 3XUI. Проверьте соединение.' }, { status: 502 });
  }
}

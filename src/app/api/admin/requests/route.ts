import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Получить список всех заявок на VPN
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const requests = await prisma.vpnRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, requests });
  } catch (error: any) {
    console.error('Error fetching VPN requests:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка заявок' }, { status: 500 });
  }
}

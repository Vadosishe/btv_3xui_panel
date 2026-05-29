import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 1. POST — Отправить новую заявку на VPN
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, telegram, name, description } = body;

    // Validate email presence
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email обязателен для заполнения' },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { success: false, error: 'Введите корректный email адрес' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check for duplicate pending request with same email
    const existingRequest = await prisma.vpnRequest.findFirst({
      where: {
        email: cleanEmail,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      return NextResponse.json(
        { success: false, error: 'У вас уже есть активная заявка на рассмотрении' },
        { status: 400 }
      );
    }

    // Create the VPN request
    await prisma.vpnRequest.create({
      data: {
        email: cleanEmail,
        telegram: telegram || '',
        name: name || '',
        description: description || '',
        source: 'WEB',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Заявка успешно отправлена',
    });
  } catch (error) {
    console.error('Error creating VPN request:', error);
    return NextResponse.json(
      { success: false, error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}

// 2. GET — Проверить статус заявки по email (анонимно, без авторизации)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email');

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Email обязателен для проверки' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // Находим последнюю заявку по данному email
    const vpnRequest = await prisma.vpnRequest.findFirst({
      where: { email: cleanEmail },
      orderBy: { createdAt: 'desc' },
    });

    if (!vpnRequest) {
      return NextResponse.json(
        { success: false, error: 'Заявка с таким email не найдена' },
        { status: 404 }
      );
    }

    let subscriptionToken = '';
    if (vpnRequest.status === 'APPROVED' && vpnRequest.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: vpnRequest.clientId },
      });
      subscriptionToken = client?.subscriptionToken || '';
    }

    return NextResponse.json({
      success: true,
      status: vpnRequest.status,
      adminNote: vpnRequest.adminNote || '',
      subscriptionToken,
    });
  } catch (error) {
    console.error('Error fetching VPN request status:', error);
    return NextResponse.json(
      { success: false, error: 'Внутренняя ошибка сервера' },
      { status: 500 }
    );
  }
}

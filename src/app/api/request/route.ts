import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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

    // Check for duplicate pending request with same email
    const existingRequest = await prisma.vpnRequest.findFirst({
      where: {
        email: email.trim(),
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
        email: email.trim(),
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

import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/auth';

export async function POST() {
  try {
    await deleteSession();
    
    const response = NextResponse.json({
      success: true,
      message: 'Сессия успешно завершена',
    });

    // Очищаем куку явно через заголовок ответа
    response.cookies.set({
      name: 'admin_session',
      value: '',
      httpOnly: true,
      expires: new Date(0),
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Ошибка при выходе из системы' },
      { status: 500 }
    );
  }
}

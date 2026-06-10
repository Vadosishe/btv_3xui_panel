import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { TemplateService } from '@/lib/services/template-service';

// 1. Получить список всех шаблонов
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const templates = await TemplateService.getTemplatesList();
    return NextResponse.json({ success: true, templates });
  } catch (error: any) {
    console.error('Error fetching templates:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка шаблонов' }, { status: 500 });
  }
}

// 2. Создать новый шаблон
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const body = await req.json();
    const { name, inboundIds } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название шаблона обязательно' }, { status: 400 });
    }

    if (!inboundIds || !Array.isArray(inboundIds) || inboundIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Необходимо привязать хотя бы одно входящее подключение (Inbound)' }, { status: 400 });
    }

    const template = await TemplateService.createTemplate(body, session.userId);
    return NextResponse.json({ success: true, template });
  } catch (error: any) {
    console.error('Error creating template:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при создании шаблона' }, { status: 400 });
  }
}


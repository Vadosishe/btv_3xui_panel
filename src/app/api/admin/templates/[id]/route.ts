import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { TemplateService } from '@/lib/services/template-service';

// Получить конкретный шаблон
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const template = await TemplateService.getTemplateDetails(id);

    if (!template) {
      return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
    }

    return NextResponse.json({ success: true, template });
  } catch (error: any) {
    console.error('Error fetching template details:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении данных шаблона' }, { status: 500 });
  }
}

// Обновить шаблон
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { name, inboundIds } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название шаблона обязательно' }, { status: 400 });
    }

    if (!inboundIds || !Array.isArray(inboundIds) || inboundIds.length === 0) {
      return NextResponse.json({ success: false, error: 'Необходимо привязать хотя бы одно входящее подключение (Inbound)' }, { status: 400 });
    }

    const updatedTemplate = await TemplateService.updateTemplate(id, body, session.userId);
    return NextResponse.json({ success: true, template: updatedTemplate });
  } catch (error: any) {
    console.error('Error updating template:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при обновлении данных шаблона' }, { status: 400 });
  }
}

// Безопасное удаление шаблона (с проверкой зависимости клиентов)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    await TemplateService.deleteTemplate(id, session.userId);

    return NextResponse.json({ success: true, message: 'Шаблон успешно удален' });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при удалении шаблона' }, { status: 400 });
  }
}


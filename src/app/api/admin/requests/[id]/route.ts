import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { ClientService } from '@/lib/services/client-service';
import { sendTelegramMessage } from '@/lib/telegram';

// GET — Получить одну заявку по ID
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const request = await prisma.vpnRequest.findUnique({ where: { id } });
    if (!request) {
      return NextResponse.json({ success: false, error: 'Заявка не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true, request });
  } catch (error: any) {
    console.error('Error fetching VPN request:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении заявки' }, { status: 500 });
  }
}

// PUT — Обновить статус заявки (одобрить / отклонить)
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const { status, adminNote, companyId, templateId, clientName } = await req.json();

    // Получаем заявку
    const request = await prisma.vpnRequest.findUnique({ where: { id } });
    if (!request) {
      return NextResponse.json({ success: false, error: 'Заявка не найдена' }, { status: 404 });
    }

    // ==================== ОДОБРЕНИЕ ====================
    if (status === 'APPROVED') {
      if (!companyId) {
        return NextResponse.json({ success: false, error: 'Необходимо выбрать компанию' }, { status: 400 });
      }
      if (!templateId) {
        return NextResponse.json({ success: false, error: 'Необходимо выбрать шаблон VPN' }, { status: 400 });
      }

      const finalClientName = clientName || request.name || request.email;

      // Делегируем создание клиента в ClientService
      const createRes = await ClientService.createClients({
        name: finalClientName,
        companyId,
        templateId,
      }, session.userId);

      if (!createRes.success || createRes.clients.length === 0) {
        return NextResponse.json({ success: false, error: createRes.lastError || 'Не удалось создать клиента на VPN сервере' }, { status: 502 });
      }

      const newClient = createRes.clients[0];

      // Обновляем заявку
      await prisma.vpnRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          adminNote: adminNote || '',
          clientId: newClient.id,
        },
      });

      // Telegram уведомление
      if (request.telegramChatId) {
        try {
          const botTokenSetting = await prisma.appSetting.findUnique({ where: { key: 'tg_bot_token' } });
          const panelUrlSetting = await prisma.appSetting.findUnique({ where: { key: 'app_panel_url' } });
          const botToken = botTokenSetting?.value;
          const panelUrl = panelUrlSetting?.value || process.env.NEXTAUTH_URL || 'http://localhost:3000';

          if (botToken) {
            const subLink = `${panelUrl}/api/sub/${newClient.subscriptionToken}`;
            const msg = `✅ <b>Ваша заявка на VPN одобрена!</b>\n\n` +
              `Привет, ${finalClientName}! Ваш запрос на VPN-подключение был одобрен администратором.\n\n` +
              `🔗 <b>Ссылка подписки:</b>\n<code>${subLink}</code>\n\n` +
              `📱 Скопируйте ссылку и добавьте её в VPN-клиент (Happ, v2rayNG, Shadowrocket и др.)`;

            await sendTelegramMessage(botToken, request.telegramChatId, msg);
          }
        } catch (tgErr) {
          console.error('Failed to send Telegram approval notification:', tgErr);
        }
      }

      return NextResponse.json({
        success: true,
        client: {
          ...newClient,
          usedTrafficBytes: newClient.usedTrafficBytes.toString(),
        },
      });
    }

    // ==================== ОТКЛОНЕНИЕ ====================
    if (status === 'DENIED') {
      await prisma.vpnRequest.update({
        where: { id },
        data: {
          status: 'DENIED',
          adminNote: adminNote || '',
        },
      });

      // Аудит
      await prisma.auditLog.create({
        data: {
          action: 'DENY_REQUEST',
          details: `Отклонена заявка от ${request.email}. Причина: ${adminNote || 'не указана'}`,
          adminId: session.userId,
        },
      });

      // Telegram уведомление об отказе
      if (request.telegramChatId) {
        try {
          const botTokenSetting = await prisma.appSetting.findUnique({ where: { key: 'tg_bot_token' } });
          const botToken = botTokenSetting?.value;

          if (botToken) {
            const reason = adminNote ? `\n\n💬 <b>Комментарий:</b> ${adminNote}` : '';
            const msg = `❌ <b>Ваша заявка на VPN отклонена</b>\n\n` +
              `К сожалению, ваш запрос на VPN-подключение был отклонён администратором.${reason}\n\n` +
              `Если у вас есть вопросы, свяжитесь с поддержкой.`;

            await sendTelegramMessage(botToken, request.telegramChatId, msg);
          }
        } catch (tgErr) {
          console.error('Failed to send Telegram denial notification:', tgErr);
        }
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Неизвестный статус' }, { status: 400 });
  } catch (error: any) {
    console.error('Error updating VPN request:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при обновлении заявки' }, { status: 500 });
  }
}

// DELETE — Удалить заявку
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;

    const request = await prisma.vpnRequest.findUnique({ where: { id } });
    if (!request) {
      return NextResponse.json({ success: false, error: 'Заявка не найдена' }, { status: 404 });
    }

    await prisma.vpnRequest.delete({ where: { id } });

    // Аудит
    await prisma.auditLog.create({
      data: {
        action: 'DELETE_REQUEST',
        details: `Удалена заявка от ${request.email} (статус: ${request.status})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting VPN request:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при удалении заявки' }, { status: 500 });
  }
}

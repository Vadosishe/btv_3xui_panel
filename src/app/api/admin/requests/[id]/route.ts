import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiAddClient, xuiDeleteClient, getCleanLatinName, xuiClearCache } from '@/lib/xui';
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

      // Получаем компанию и шаблон
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      const template = await prisma.template.findUnique({ where: { id: templateId } });

      if (!company) {
        return NextResponse.json({ success: false, error: 'Компания не найдена' }, { status: 404 });
      }
      if (!template) {
        return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
      }

      // Генерация уникальных идентификаторов клиента
      const clientUuid = crypto.randomUUID();
      const subToken = crypto.randomUUID();
      const finalClientName = clientName || request.name || request.email;
      const cleanName = getCleanLatinName(finalClientName);
      const clientEmail = `${cleanName}_${clientUuid.slice(0, 8)}@btv.vpn`;

      // Парсим инбаунды из шаблона
      let inboundIds: number[] = [];
      try {
        inboundIds = JSON.parse(template.inboundIdsJson || '[]');
      } catch (e) {
        return NextResponse.json({ success: false, error: 'Ошибка структуры инбаундов в шаблоне' }, { status: 500 });
      }

      if (inboundIds.length === 0) {
        return NextResponse.json({ success: false, error: 'В выбранном шаблоне нет активных инбаундов 3XUI' }, { status: 400 });
      }

      // Вычисляем лимиты из шаблона
      const trafficLimitGB = template.trafficLimitGB;
      const limitIp = template.limitIp;
      const flow = template.flow || '';

      // Лимит трафика в байтах
      const trafficBytesLimit = trafficLimitGB > 0
        ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
        : BigInt(0);

      // Срок действия
      let expiresAt: Date | null = null;
      if (template.durationDays > 0) {
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + template.durationDays);
        expiresAt = expDate;
      }
      const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;

      // Регистрация клиента на 3XUI сервере
      const addedInboundIds: number[] = [];
      for (const inboundId of inboundIds) {
        try {
          const added = await xuiAddClient(inboundId, {
            id: clientUuid,
            email: clientEmail,
            limitIp,
            totalGB: Number(trafficBytesLimit),
            expiryTime: expiryTimeMs,
            enable: true,
            flow,
            tgId: '',
            templateId,
            group: company.name,
          });

          if (added) {
            addedInboundIds.push(inboundId);
          } else {
            // Откат ранее добавленных
            for (const addedId of addedInboundIds) {
              try { await xuiDeleteClient(addedId, clientEmail); } catch (e) {}
            }
            return NextResponse.json({ success: false, error: `Панель 3XUI отклонила добавление в Inbound ID ${inboundId}` }, { status: 502 });
          }
        } catch (err: any) {
          // Откат при ошибке
          for (const addedId of addedInboundIds) {
            try { await xuiDeleteClient(addedId, clientEmail); } catch (e) {}
          }
          return NextResponse.json({ success: false, error: `Ошибка подключения к API 3XUI: ${err.message}` }, { status: 502 });
        }
      }

      // Создаём клиента в БД
      const newClient = await prisma.client.create({
        data: {
          name: finalClientName,
          email: clientEmail,
          vpnUuid: clientUuid,
          subscriptionToken: subToken,
          companyId,
          templateId,
        },
      });

      // Обновляем заявку
      await prisma.vpnRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          adminNote: adminNote || '',
          clientId: newClient.id,
        },
      });

      // Аудит
      await prisma.auditLog.create({
        data: {
          action: 'APPROVE_REQUEST',
          details: `Одобрена заявка от ${request.email}. Создан клиент: ${finalClientName} (Компания: ${company.name}, Шаблон: ${template.name})`,
          adminId: session.userId,
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
            const subLink = `${panelUrl}/api/sub/${subToken}`;
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

      // Очистка кэша
      try { xuiClearCache(); } catch (e) {}

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

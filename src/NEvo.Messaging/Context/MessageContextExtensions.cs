namespace NEvo.Messaging.Context;

public static class MessageContextExtensions
{
    public static ThreadingOptions GetThreadingOptions(this IMessageContext context) => context.GetFeature<ThreadingOptions>();
}
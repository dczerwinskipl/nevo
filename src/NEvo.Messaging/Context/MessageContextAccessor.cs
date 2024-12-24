namespace NEvo.Messaging.Context;

public class MessageContextAccessor : IMessageContextAccessor
{
    private static readonly AsyncLocal<MessageContextHolder> _httpContextCurrent = new AsyncLocal<MessageContextHolder>();

    /// <inheritdoc/>
    public IMessageContext? MessageContext
    {
        get
        {
            return _httpContextCurrent.Value?.Context;
        }
        set
        {
            var holder = _httpContextCurrent.Value;
            if (holder != null)
            {
                // Clear current HttpContext trapped in the AsyncLocals, as its done.
                holder.Context = null;
            }

            if (value != null)
            {
                // Use an object indirection to hold the HttpContext in the AsyncLocal,
                // so it can be cleared in all ExecutionContexts when its cleared.
                _httpContextCurrent.Value = new MessageContextHolder { Context = value };
            }
        }
    }

    private sealed class MessageContextHolder
    {
        public IMessageContext? Context;
    }
}
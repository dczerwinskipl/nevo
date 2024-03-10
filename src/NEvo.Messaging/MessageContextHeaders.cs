using System.Collections.ObjectModel;
using LanguageExt;

namespace NEvo.Messaging;

public class MessageContextHeaders : ReadOnlyDictionary<string, string>, IMessageContextHeaders
{
    public const string CorrelationIdKey = nameof(CorrelationId);
    public const string CausationIdKey = nameof(CausationId);

    public MessageContextHeaders(IDictionary<string, string> dictionary) : base(Check.Null(dictionary))
    {
    }

    public Option<string> CorrelationId => TryGetValue(CorrelationIdKey, out var correlationId) ? correlationId : null;

    public Option<string> CausationId => TryGetValue(CausationIdKey, out var causationId) ? causationId : null;
}

﻿using System.Diagnostics.CodeAnalysis;
using NEvo.Messaging.Attributes;

namespace NEvo.Messaging.Events.Attributes;

[ExcludeFromCodeCoverage]
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = true)]
public class DomainEventAttribute : MessageVisibilityAttribute
{
    public override bool IsPrivate => true;
}
